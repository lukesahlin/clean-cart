# main.py -- Clean Cart FastAPI backend
# Run with: uvicorn main:app --reload
#
# Endpoints:
#   POST /recommend          -- takes a grocery list + user avoid prefs, returns clean picks
#   GET  /autocomplete       -- item name suggestions for a partial query
#   GET  /categories         -- available filter categories
#   GET  /nearby-stores      -- nearby grocery store branches via Google Places API
#   POST /availability       -- check a product at a list of store branches (scrapes live)
#   GET  /health             -- simple health check

import os
import asyncio
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# load .env file if present (dev convenience)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from filter_engine import CATEGORY_MAP
from product_matcher import fetch_products_for_item, get_autocomplete_suggestions
from recommendation_ranker import rank_products
from nearby_stores import find_nearby_stores
from availability_cache import get_cached, set_cached
from search_cache import cache_stats as search_cache_stats

# -- App setup ----------------------------------------------------------------

app = FastAPI(
    title="Clean Cart API",
    description="Clean grocery product recommendations + nearby store availability.",
    version="0.2.0",
)

# Allow origins from env var (space-separated) + local dev defaults.
# In production set ALLOWED_ORIGINS="https://your-app.vercel.app" in Railway.
_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split() if o.strip()]
_dev_origins = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"]
_all_origins = list(dict.fromkeys(_dev_origins + _extra_origins))  # dedupe, keep order

app.add_middleware(
    CORSMiddleware,
    allow_origins=_all_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",   # covers all Vercel preview URLs
    allow_methods=["*"],
    allow_headers=["*"],
)

# -- Adapter registry ---------------------------------------------------------
# Maps chain_id to the check_availability function for that store.
# Add new adapters here without touching anything else.

def _load_adapters():
    registry = {}
    try:
        from adapters.walmart import check_availability as walmart_check
        registry["walmart"] = walmart_check
    except Exception:
        pass
    try:
        from adapters.safeway import check_availability as safeway_check
        registry["safeway"] = safeway_check
    except Exception:
        pass
    try:
        from adapters.fred_meyer import check_availability as fm_check
        registry["fred_meyer"] = fm_check
    except Exception:
        pass
    try:
        from adapters.albertsons import check_availability as albertsons_check
        registry["albertsons"] = albertsons_check
    except Exception:
        pass
    try:
        from adapters.whole_foods import check_availability as wf_check
        registry["whole_foods"] = wf_check
    except Exception:
        pass
    try:
        from adapters.trader_joes import check_availability as tj_check
        registry["trader_joes"] = tj_check
    except Exception:
        pass
    try:
        # Kroger API covers Fred Meyer, QFC, and Kroger banners
        from adapters.kroger import check_availability as kroger_check
        registry["kroger"] = kroger_check
        # keep old fred_meyer key working if anything still uses it
        registry["fred_meyer"] = kroger_check
    except Exception:
        pass
    return registry

ADAPTERS = _load_adapters()

# -- Request / response models ------------------------------------------------

class RecommendRequest(BaseModel):
    items: list[str]
    avoid: list[str] = []
    top_n: int = 10

class IngredientFlag(BaseModel):
    ingredient: str
    category: str

class FilterResultResponse(BaseModel):
    is_clean: bool
    flagged: list[IngredientFlag]
    checked_categories: list[str]

class HealthScoreResponse(BaseModel):
    score: int
    grade: str
    warnings: list[str]
    positives: list[str]
    breakdown: dict


class ProductResponse(BaseModel):
    barcode: str
    product_name: str
    brand: str
    ingredient_text: str
    completeness_pct: int
    is_organic: bool
    image_url: str
    nutriscore: str
    nova_group: int | None = None
    score: float
    filter_result: FilterResultResponse
    health_score: HealthScoreResponse | None = None

class ItemRecommendation(BaseModel):
    item: str
    recommendations: list[ProductResponse]
    found_clean: bool
    total_products_checked: int

class RecommendResponse(BaseModel):
    results: list[ItemRecommendation]
    available_avoid_categories: list[str]

class NearbyStoreResponse(BaseModel):
    place_id: str
    name: str
    chain_id: str
    address: str
    lat: float
    lng: float
    distance_meters: int

class AvailabilityRequest(BaseModel):
    product_query: str          # e.g. "Siete tortilla chips"
    stores: list[NearbyStoreResponse]
    zip_code: str = "99201"

class AvailabilityResultResponse(BaseModel):
    product_name: str
    in_stock: bool
    price: float | None
    store_name: str
    store_branch_id: str
    chain_id: str
    last_checked: str
    source_url: str
    from_cache: bool = False

# -- Routes -------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "adapters_loaded": list(ADAPTERS.keys()),
        "search_cache": search_cache_stats(),
    }


@app.get("/product/barcode/{barcode}")
async def product_by_barcode(barcode: str, avoid: str = ""):
    """
    Look up a single product by barcode (UPC or EAN), run it through the
    normalization + scoring pipeline, and return the same shape as /recommend.
    avoid = comma-separated extra categories, e.g. "artificial_sweeteners,high_fructose_corn_syrup"
    """
    import httpx as _httpx
    from filter_engine import analyze_off_product
    from scoring_engine import score_product

    user_avoid = [c.strip() for c in avoid.split(",") if c.strip()] if avoid else []

    # fetch from Open Food Facts
    url = f"https://world.openfoodfacts.org/api/v0/product/{barcode}.json"
    fields = "product_name,brands,ingredients_text,ingredients_tags,additives_tags,ingredients_analysis_tags,nova_group,completeness,labels,image_small_url,image_url,nutriscore_grade"
    try:
        resp = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _httpx.get(f"{url}?fields={fields}", timeout=8.0)
        )
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Open Food Facts lookup failed: {e}")

    if data.get("status") != 1:
        raise HTTPException(status_code=404, detail="Product not found in Open Food Facts")

    p = data.get("product", {})
    if not p.get("product_name"):
        raise HTTPException(status_code=404, detail="Product found but has no name — data may be incomplete")

    off_dict = {
        "ingredients_text": p.get("ingredients_text", ""),
        "ingredients_tags": p.get("ingredients_tags", []) or [],
        "additives_tags": p.get("additives_tags", []) or [],
        "ingredients_analysis_tags": p.get("ingredients_analysis_tags", []) or [],
    }
    filter_result = analyze_off_product(off_dict, user_avoid=user_avoid)

    product_meta = {
        "is_organic": "organic" in (p.get("labels", "") or "").lower(),
        "nutriscore": p.get("nutriscore_grade", ""),
        "nova_group": p.get("nova_group"),
        "ingredient_text": p.get("ingredients_text", ""),
        "additives_tags": p.get("additives_tags", []) or [],
    }
    hs = score_product(filter_result, product_meta)

    return {
        "barcode": barcode,
        "product_name": p.get("product_name", "").strip(),
        "brand": p.get("brands", "").strip(),
        "ingredient_text": p.get("ingredients_text", ""),
        "is_organic": product_meta["is_organic"],
        "image_url": p.get("image_small_url", "") or p.get("image_url", ""),
        "nutriscore": p.get("nutriscore_grade", ""),
        "nova_group": p.get("nova_group"),
        "completeness_pct": round((p.get("completeness", 0) or 0) * 100),
        "filter_result": filter_result,
        "health_score": hs.to_dict(),
    }


@app.get("/geocode")
async def geocode(q: str):
    """
    Converts a place name, city, or zip code into lat/lng using Nominatim
    (OpenStreetMap's free geocoding service — no API key needed).
    Returns the best match with display_name, lat, lng.
    """
    import httpx as _httpx
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query too short")
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {"q": q.strip(), "format": "json", "limit": 3, "countrycodes": "us,ca,gb,au"}
        headers = {"User-Agent": "CleanCart/1.0 (grocery app)"}
        resp = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _httpx.get(url, params=params, headers=headers, timeout=8.0)
        )
        results = resp.json()
        if not results:
            raise HTTPException(status_code=404, detail="Location not found")
        best = results[0]
        return {
            "lat": float(best["lat"]),
            "lng": float(best["lon"]),
            "display_name": best.get("display_name", ""),
            "short_name": best.get("display_name", "").split(",")[0].strip(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Geocoding failed: {e}")


@app.get("/reverse-geocode")
async def reverse_geocode(lat: float, lng: float):
    """
    Converts lat/lng to a postal code (zip) using Nominatim reverse geocoding.
    Returns { zip_code, city, state, display_name }.
    Used by the frontend to pass an accurate zip to store availability adapters.
    """
    import httpx as _httpx
    try:
        url = "https://nominatim.openstreetmap.org/reverse"
        params = {"lat": lat, "lon": lng, "format": "json", "addressdetails": 1}
        headers = {"User-Agent": "CleanCart/1.0 (grocery app)"}
        resp = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _httpx.get(url, params=params, headers=headers, timeout=8.0)
        )
        data = resp.json()
        address = data.get("address", {})
        zip_code = address.get("postcode", "").split("-")[0]   # strip ZIP+4 extension
        city  = address.get("city") or address.get("town") or address.get("village", "")
        state = address.get("state", "")
        return {
            "zip_code":     zip_code,
            "city":         city,
            "state":        state,
            "display_name": data.get("display_name", ""),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Reverse geocoding failed: {e}")


@app.get("/autocomplete")
def autocomplete(q: str, limit: int = 8):
    if not q or len(q.strip()) < 1:
        return {"suggestions": []}
    return {"suggestions": get_autocomplete_suggestions(q, limit=limit)}


@app.get("/categories")
def list_categories():
    return {"categories": list(CATEGORY_MAP.keys())}


@app.get("/nearby-stores")
async def nearby_stores(lat: float, lng: float, radius: int = 8000):
    """
    Returns nearby grocery store branches using the Google Places API.
    Requires GOOGLE_PLACES_API_KEY to be set in the environment / .env file.
    """
    key = os.getenv("GOOGLE_PLACES_API_KEY", "")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, find_nearby_stores, lat, lng, radius)
    # find_nearby_stores now returns (stores_list, debug_info)
    if isinstance(result, tuple):
        stores, debug_info = result
    else:
        stores, debug_info = result, {}
    return {
        "stores": [s.to_dict() for s in stores],
        "api_key_configured": bool(key and key.strip() not in ("", "your_key_here")),
        "debug": debug_info,
    }


@app.post("/availability")
async def check_availability_endpoint(request: AvailabilityRequest):
    """
    Checks whether a product is available at each of the provided store branches.
    Results are cached in SQLite for CACHE_TTL_HOURS to avoid hammering store sites.
    """
    if not request.product_query.strip():
        raise HTTPException(status_code=400, detail="product_query cannot be empty")
    if len(request.stores) > 6:
        raise HTTPException(status_code=400, detail="max 6 stores per request")

    loop = asyncio.get_event_loop()
    results = []

    for store in request.stores:
        chain_id = store.chain_id

        # check cache first
        cached = get_cached(request.product_query, store.place_id)
        if cached:
            cached["from_cache"] = True
            results.append(cached)
            continue

        # no cache -- hit the store if we have an adapter
        adapter = ADAPTERS.get(chain_id)
        if not adapter:
            # no adapter yet -- skip rather than error
            continue

        result = await loop.run_in_executor(
            None, adapter,
            request.product_query,
            store.place_id,
            store.name,
            request.zip_code,
        )

        result_dict = result.to_dict()
        set_cached(request.product_query, store.place_id, result_dict)
        result_dict["from_cache"] = False
        results.append(result_dict)

    return {"results": results}


@app.post("/recommend", response_model=RecommendResponse)
async def recommend(request: RecommendRequest):
    if not request.items:
        raise HTTPException(status_code=400, detail="items list cannot be empty")
    if len(request.items) > 20:
        raise HTTPException(status_code=400, detail="maximum 20 items per request")

    loop = asyncio.get_event_loop()

    async def process_item(item_name):
        products = await loop.run_in_executor(None, fetch_products_for_item, item_name)
        ranked = rank_products(products, user_avoid=request.avoid or None, top_n=request.top_n)

        product_responses = []
        for sp in ranked:
            d = sp.to_dict()
            hs_data = d.get("health_score") or {}
            product_responses.append(ProductResponse(
                barcode=d["barcode"],
                product_name=d["product_name"],
                brand=d["brand"],
                ingredient_text=d["ingredient_text"],
                completeness_pct=d["completeness_pct"],
                is_organic=d["is_organic"],
                image_url=d["image_url"],
                nutriscore=d["nutriscore"],
                nova_group=d.get("nova_group"),
                score=d["score"],
                filter_result=FilterResultResponse(
                    is_clean=d["filter_result"]["is_clean"],
                    flagged=[IngredientFlag(ingredient=f["ingredient"], category=f["category"])
                             for f in d["filter_result"]["flagged"]],
                    checked_categories=d["filter_result"]["checked_categories"],
                ),
                health_score=HealthScoreResponse(
                    score=hs_data.get("score", 100),
                    grade=hs_data.get("grade", "unknown"),
                    warnings=hs_data.get("warnings", []),
                    positives=hs_data.get("positives", []),
                    breakdown=hs_data.get("breakdown", {}),
                ) if hs_data else None,
            ))

        return ItemRecommendation(
            item=item_name,
            recommendations=product_responses,
            found_clean=len(product_responses) > 0,
            total_products_checked=len(products),
        )

    results = await asyncio.gather(*[process_item(item) for item in request.items])
    return RecommendResponse(
        results=list(results),
        available_avoid_categories=list(CATEGORY_MAP.keys()),
    )
