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
import math
import asyncio
import logging
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger("cleancart")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

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
    allow_credentials=False,
)

# Explicit OPTIONS handler — catches Railway edge cases where preflight
# gets a 404 before reaching the CORSMiddleware
@app.options("/{rest_of_path:path}")
async def preflight(rest_of_path: str, request: Request):
    origin = request.headers.get("origin", "*")
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
            "Access-Control-Max-Age": "86400",
        },
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

class InstacartSearchRequest(BaseModel):
    query: str
    zip_code: str = "99201"
    avoid: list[str] = []

class ShopRequest(BaseModel):
    query: str                  # e.g. "tortilla chips"
    lat: float                  # user's latitude
    lng: float                  # user's longitude
    zip_code: str = ""          # derived from lat/lng on the backend if not provided
    radius_meters: int = 8000   # store search radius
    avoid: list[str] = []       # filter categories to flag
    top_n: int = 10             # max products per store to return

class ShopAtStoreRequest(BaseModel):
    query: str
    location_id: str = ""       # Kroger location ID (empty for Walmart)
    chain: str = ""             # e.g. "FRED", "QFC", "WALMART"
    store_name: str = ""
    lat: float = 0
    lng: float = 0
    zip_code: str = ""
    avoid: list[str] = []
    top_n: int = 10

# -- Routes -------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "adapters_loaded": list(ADAPTERS.keys()),
        "search_cache": search_cache_stats(),
    }


@app.get("/test/stores")
async def test_stores(lat: float = 47.6588, lng: float = -117.4260, radius: int = 8000):
    """
    Test Google Places store discovery.
    Usage: /test/stores?lat=47.65&lng=-117.42
    Shows which stores were found and whether GOOGLE_PLACES_API_KEY is set.
    """
    import os
    key_set = bool(os.getenv("GOOGLE_PLACES_API_KEY", "").strip())
    loop = asyncio.get_event_loop()
    stores, debug = await loop.run_in_executor(None, find_nearby_stores, lat, lng, radius)
    return {
        "google_places_key_set": key_set,
        "stores_found": [s.to_dict() for s in stores],
        "debug": debug,
    }


@app.get("/test/kroger")
async def test_kroger(zip_code: str = "", query: str = "tortilla chips"):
    """
    Kroger API credential + store discovery test.
    Searches for ALL Kroger-family stores near zip_code (no chain filter)
    so we can see exactly which banners exist in the area, then tries a
    product search against the first one found.
    """
    import os
    import httpx as _httpx

    result = {
        "credentials_set": bool(os.getenv("KROGER_CLIENT_ID")) and bool(os.getenv("KROGER_CLIENT_SECRET")),
        "token": None,
        "stores_found": [],
        "products": [],
        "error": None,
    }

    if not result["credentials_set"]:
        result["error"] = "KROGER_CLIENT_ID or KROGER_CLIENT_SECRET not set in environment"
        return result

    if not zip_code:
        result["error"] = "Pass a zip code to test: /test/kroger?zip_code=98101"
        return result

    try:
        from adapters.kroger import _get_token, _search_products, LOCATIONS_URL
        loop = asyncio.get_event_loop()

        # step 1 — get token
        token = await loop.run_in_executor(None, _get_token)
        result["token"] = "✓ obtained" if token else "✗ failed"
        if not token:
            return result

        # step 2 — find ALL Kroger-family stores near zip (no chain filter)
        def _find_all_stores():
            headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
            params  = {
                "filter.zipCode.near": zip_code,
                "filter.radiusInMiles": 25,
                "filter.limit": 10,
            }
            resp = _httpx.get(LOCATIONS_URL, headers=headers, params=params, timeout=10)
            if resp.status_code != 200:
                return [], f"Locations API returned {resp.status_code}: {resp.text[:200]}"
            locations = resp.json().get("data", [])
            stores = [
                {
                    "locationId": loc.get("locationId"),
                    "name": loc.get("name"),
                    "chain": loc.get("chain"),
                    "address": (loc.get("address") or {}).get("addressLine1", ""),
                    "city": (loc.get("address") or {}).get("city", ""),
                }
                for loc in locations
            ]
            return stores, None

        stores, err = await loop.run_in_executor(None, _find_all_stores)
        if err:
            result["error"] = err
            return result

        result["stores_found"] = stores

        # step 3 — search products at first store found
        if stores:
            first_id = stores[0]["locationId"]
            products = await loop.run_in_executor(None, _search_products, query, first_id)
            result["products"] = [
                {
                    "name":  p.get("description", ""),
                    "brand": p.get("brand", ""),
                    "price": (p.get("items") or [{}])[0].get("price", {}).get("regular"),
                }
                for p in products[:3]
            ]
            if not products:
                result["error"] = f"Store found but no products for '{query}' — check API scope includes product.compact"
        else:
            result["error"] = f"No Kroger-family stores found within 25 miles of {zip_code}"

    except Exception as e:
        result["error"] = str(e)

    return result


CLEAN_BRANDS = [
    "primal kitchen", "chosen foods", "tessemae", "sir kensington",
    "simple mills", "siete", "kettle and fire", "hu kitchen",
    "rxbar", "epic provisions", "jackson's", "boulder canyon",
]


def _filter_and_score(products: list[dict], avoid: list[str], top_n: int = 10) -> list[dict]:
    """Run filter + health-score on a list of raw products, return sorted top_n."""
    from filter_engine import analyze_off_product
    from scoring_engine import score_product

    results = []
    for p in products:
        ingredient_text = p.get("ingredient_text", "")
        if ingredient_text:
            off_dict = {
                "ingredients_text": ingredient_text,
                "ingredients_tags": p.get("ingredients_tags", []) or [],
                "additives_tags": p.get("additives_tags", []) or [],
                "ingredients_analysis_tags": p.get("ingredients_analysis_tags", []) or [],
            }
            filter_result = analyze_off_product(off_dict, user_avoid=avoid)
            product_meta = {
                "is_organic": "organic" in ingredient_text.lower(),
                "nutriscore": p.get("nutriscore", ""),
                "nova_group": p.get("nova_group"),
                "ingredient_text": ingredient_text,
                "additives_tags": p.get("additives_tags", []) or [],
            }
            hs = score_product(filter_result, product_meta)
            health_score = hs.to_dict()
        else:
            filter_result = {
                "is_clean": True, "flagged": [], "checked_categories": [],
                "ingredients_unknown": True,
            }
            health_score = {
                "score": -1, "grade": "unknown",
                "warnings": ["Ingredient data not available — scan barcode in store"],
                "positives": [], "breakdown": {},
            }

        results.append({**p, "filter_result": filter_result, "health_score": health_score})

    results.sort(key=lambda x: (
        (x.get("filter_result") or {}).get("ingredients_unknown", False),
        not (x.get("filter_result") or {}).get("is_clean", True),
        -(x.get("health_score") or {}).get("score", 0),
    ))
    return results[:top_n]


class DiscoverStoresRequest(BaseModel):
    lat: float
    lng: float
    zip_code: str = ""
    radius_meters: int = 40000


def _haversine(lat1, lng1, lat2, lng2):
    R = 6371000
    p = math.pi / 180
    a = (0.5 - math.cos((lat2 - lat1) * p) / 2 +
         math.cos(lat1 * p) * math.cos(lat2 * p) *
         (1 - math.cos((lng2 - lng1) * p)) / 2)
    return R * 2 * math.asin(math.sqrt(a))


async def _resolve_zip(lat: float, lng: float, zip_code: str) -> str:
    """Derive zip code from coordinates if not provided."""
    if zip_code:
        return zip_code
    try:
        import httpx as _httpx
        loop = asyncio.get_event_loop()
        geo_resp = await loop.run_in_executor(None, lambda: _httpx.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lng, "format": "json"},
            headers={"User-Agent": "CleanCart/1.0"},
            timeout=6,
        ))
        resolved = geo_resp.json().get("address", {}).get("postcode", "").split("-")[0]
        if resolved:
            logger.info("  Resolved zip: %s", resolved)
        return resolved
    except Exception:
        return ""


@app.post("/discover-stores")
async def discover_stores(request: DiscoverStoresRequest):
    """
    Fast store discovery — returns nearby Kroger-family store locations
    and a Walmart pin without searching any products.
    Call this first so the map populates immediately.
    """
    from adapters.kroger import find_nearby_kroger_stores

    loop = asyncio.get_event_loop()

    zip_code = await _resolve_zip(request.lat, request.lng, request.zip_code)

    nearby_kroger = await loop.run_in_executor(
        None, lambda: find_nearby_kroger_stores(
            zip_code=zip_code, limit=15,
            lat=request.lat, lng=request.lng
        )
    )

    chain_id_map = {"FRED": "fred_meyer", "QFC": "qfc"}
    pins = []
    for kstore in nearby_kroger:
        dist = _haversine(request.lat, request.lng, kstore["lat"], kstore["lng"])
        if dist <= request.radius_meters:
            pins.append({
                "store_name": kstore["name"],
                "chain_id": chain_id_map.get(kstore["chain"], "kroger"),
                "address": kstore["address"],
                "lat": kstore["lat"],
                "lng": kstore["lng"],
                "distance_meters": round(dist),
                "location_id": kstore["location_id"],
                "chain": kstore["chain"],
            })

    pins.sort(key=lambda p: p["distance_meters"])

    # include a Walmart pin at the user's location
    pins.append({
        "store_name": "Walmart",
        "chain_id": "walmart",
        "address": f"Near {zip_code}",
        "lat": request.lat,
        "lng": request.lng,
        "distance_meters": 0,
        "location_id": "",
        "chain": "WALMART",
    })

    logger.info(
        "DISCOVER STORES  lat=%.4f  lng=%.4f  zip=%s  found=%d pins",
        request.lat, request.lng, zip_code, len(pins),
    )

    return {"pins": pins, "zip_code": zip_code}


@app.post("/shop-at-store")
async def shop_at_store(request: ShopAtStoreRequest):
    """
    Search products at a SINGLE store. Called by the frontend per-store
    so results can render incrementally as each store finishes.
    """
    from adapters.kroger import search_products_at_store as kroger_search
    from adapters.walmart import search_walmart

    loop = asyncio.get_event_loop()
    zip_code = request.zip_code

    logger.info(
        "SHOP-AT-STORE  query=%r  store=%s  chain=%s  loc_id=%s",
        request.query, request.store_name, request.chain, request.location_id,
    )

    products = []

    if request.chain == "WALMART":
        products = await loop.run_in_executor(
            None, search_walmart, request.query, zip_code, ""
        )
    else:
        loc_id = request.location_id
        if not loc_id:
            return {"store_name": request.store_name, "products": [], "error": "no location_id"}

        fetch_limit = max(request.top_n * 4, 20)
        products = await loop.run_in_executor(
            None, lambda: kroger_search(
                request.query, zip_code, request.chain, fetch_limit,
                location_id=loc_id
            )
        )
        if not products:
            products = []

        # supplemental clean brand search
        found_brands = {p.get("brand", "").lower() for p in products}
        missing_clean = [b for b in CLEAN_BRANDS if b not in found_brands]

        if missing_clean:
            brand_results = await asyncio.gather(
                *[loop.run_in_executor(
                    None, lambda b=brand: kroger_search(
                        f"{b} {request.query}", zip_code, request.chain, 3,
                        location_id=loc_id
                    )
                ) for brand in missing_clean[:2]]
            )
            seen_ids = {p.get("product_id") for p in products}
            query_words = set(request.query.lower().split())
            for br in brand_results:
                for p in (br or []):
                    if p.get("product_id") in seen_ids:
                        continue
                    pname = (p.get("product_name") or p.get("description") or "").lower()
                    if any(w in pname for w in query_words):
                        products.append(p)
                        seen_ids.add(p.get("product_id"))

    if not products:
        return {
            "store_name": request.store_name,
            "chain_id": request.chain.lower() if request.chain != "WALMART" else "walmart",
            "products": [],
        }

    chain_id_map = {"FRED": "fred_meyer", "QFC": "qfc", "WALMART": "walmart"}
    scored = _filter_and_score(products, request.avoid, request.top_n)

    logger.info(
        "SHOP-AT-STORE RESULT  query=%r  store=%s  products=%d",
        request.query, request.store_name, len(scored),
    )

    return {
        "store_name": request.store_name,
        "chain_id": chain_id_map.get(request.chain, "kroger"),
        "address": f"Near {zip_code}" if request.chain == "WALMART" else "",
        "lat": request.lat,
        "lng": request.lng,
        "distance_meters": 0,
        "products": scored,
    }


@app.post("/shop")
async def shop(request: ShopRequest):
    """
    Store-first search (legacy endpoint kept for backward compatibility).
    Queries Kroger + Walmart APIs directly. Searches stores sequentially
    (closest first) and stops searching once a clean product is found.
    """
    from adapters.kroger import search_products_at_store as kroger_search
    from adapters.kroger import find_nearby_kroger_stores
    from adapters.walmart import search_walmart

    loop = asyncio.get_event_loop()

    logger.info(
        "SHOP REQUEST  query=%r  lat=%.4f  lng=%.4f  radius=%dm  zip=%s  avoid=%s",
        request.query, request.lat, request.lng, request.radius_meters,
        request.zip_code or "(auto)", request.avoid,
    )

    zip_code = await _resolve_zip(request.lat, request.lng, request.zip_code)

    if not zip_code:
        return {"query": request.query, "stores_searched": 0,
                "stores_with_results": 0, "results": [],
                "error": "Could not determine zip code from coordinates"}

    store_results = []
    all_kroger_pins = []

    # --- Kroger: discover stores, search sequentially, stop on clean ---
    async def search_kroger_stores():
        nearby_kroger = await loop.run_in_executor(
            None, lambda: find_nearby_kroger_stores(
                zip_code=zip_code, limit=15,
                lat=request.lat, lng=request.lng
            )
        )
        chain_id_map = {"FRED": "fred_meyer", "QFC": "qfc"}
        in_radius = []
        for kstore in nearby_kroger:
            dist = _haversine(request.lat, request.lng, kstore["lat"], kstore["lng"])
            if dist <= request.radius_meters:
                kstore["_dist"] = round(dist)
                in_radius.append(kstore)
                all_kroger_pins.append({
                    "store_name": kstore["name"],
                    "chain_id": chain_id_map.get(kstore["chain"], "kroger"),
                    "address": kstore["address"],
                    "lat": kstore["lat"],
                    "lng": kstore["lng"],
                    "distance_meters": round(dist),
                })

        # sort all stores by distance (closest first)
        in_radius.sort(key=lambda s: s["_dist"])

        logger.info(
            "  Kroger API: %d stores found, %d in radius — %s",
            len(nearby_kroger), len(in_radius),
            [f"{s['chain']} {s['name']} ({s['_dist']}m)" for s in in_radius],
        )

        found_clean = False

        for kstore in in_radius:
            if found_clean:
                logger.info("  Skipping %s — already found clean match", kstore["name"])
                break

            loc_id = kstore["location_id"]
            banner = kstore["chain"]
            fetch_limit = max(request.top_n * 4, 20)

            products = await loop.run_in_executor(
                None, lambda lid=loc_id: kroger_search(
                    request.query, zip_code, banner, fetch_limit, location_id=lid
                )
            )
            if not products:
                products = []

            # supplemental clean brand search — only for brands not already found
            found_brands = {p.get("brand", "").lower() for p in products}
            missing_clean = [b for b in CLEAN_BRANDS if b not in found_brands]

            if missing_clean:
                brand_results = await asyncio.gather(
                    *[loop.run_in_executor(
                        None, lambda b=brand, lid=loc_id: kroger_search(
                            f"{b} {request.query}", zip_code, banner, 3, location_id=lid
                        )
                    ) for brand in missing_clean[:2]]
                )
                seen_ids = {p.get("product_id") for p in products}
                query_words = set(request.query.lower().split())
                for br in brand_results:
                    for p in (br or []):
                        if p.get("product_id") in seen_ids:
                            continue
                        # only include if the product name actually matches the query
                        pname = (p.get("product_name") or p.get("description") or "").lower()
                        if any(w in pname for w in query_words):
                            products.append(p)
                            seen_ids.add(p.get("product_id"))

            if not products:
                continue

            scored = _filter_and_score(products, request.avoid, request.top_n)
            if scored:
                store_results.append({
                    "store_name": kstore["name"],
                    "chain_id": chain_id_map.get(banner, "kroger"),
                    "address": kstore["address"],
                    "lat": kstore["lat"],
                    "lng": kstore["lng"],
                    "distance_meters": kstore["_dist"],
                    "products": scored,
                })

                has_clean = any(
                    p.get("filter_result", {}).get("is_clean") and
                    not p.get("filter_result", {}).get("ingredients_unknown") and
                    (p.get("health_score", {}).get("score", 0) >= 70)
                    for p in scored
                )
                if has_clean:
                    found_clean = True
                    logger.info("  Clean match found at %s — stopping Kroger search", kstore["name"])

    # --- Walmart: search in parallel with Kroger ---
    async def search_walmart_store():
        products = await loop.run_in_executor(
            None, search_walmart, request.query, zip_code, ""
        )
        if not products:
            return
        scored = _filter_and_score(products, request.avoid, request.top_n)
        if scored:
            store_results.append({
                "store_name": "Walmart",
                "chain_id": "walmart",
                "address": f"Near {zip_code}",
                "lat": request.lat,
                "lng": request.lng,
                "distance_meters": 0,
                "products": scored,
            })

    try:
        await asyncio.wait_for(
            asyncio.gather(search_kroger_stores(), search_walmart_store()),
            timeout=25,
        )
    except asyncio.TimeoutError:
        logger.warning("  Shop search timed out after 25s — returning partial results")

    store_results.sort(key=lambda s: s.get("distance_meters") or 999999)

    total_products = sum(len(s["products"]) for s in store_results)
    logger.info(
        "SHOP RESULT   query=%r  stores=%d  products=%d  %s",
        request.query, len(store_results), total_products,
        [f"{s['store_name']} ({len(s['products'])} products, {s['distance_meters']}m)"
         for s in store_results],
    )

    return {
        "query": request.query,
        "stores_searched": len(store_results),
        "stores_with_results": len(store_results),
        "results": store_results,
        "nearby_pins": all_kroger_pins,
    }


@app.post("/instacart/search")
async def instacart_search(request: InstacartSearchRequest):
    """
    Search Instacart for a product using Playwright.
    Intercepts Instacart's internal API responses to get structured product data.
    Results are cached for 6 hours. First call may take 20-30 seconds.
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="query cannot be empty")

    from adapters.instacart import search_instacart_sync
    from filter_engine import analyze_off_product
    from scoring_engine import score_product

    loop = asyncio.get_event_loop()
    raw_results = await loop.run_in_executor(
        None, search_instacart_sync, request.query.strip(), request.zip_code
    )

    # run each product through the filter engine if we have ingredient text
    enriched = []
    for p in raw_results:
        filter_result = None
        health_score = None

        if p.get("ingredient_text"):
            off_dict = {
                "ingredients_text": p["ingredient_text"],
                "ingredients_tags": [],
                "additives_tags": [],
                "ingredients_analysis_tags": [],
            }
            filter_result = analyze_off_product(off_dict, user_avoid=request.avoid)
            product_meta = {
                "is_organic": "organic" in p["ingredient_text"].lower(),
                "nutriscore": "",
                "nova_group": None,
                "ingredient_text": p["ingredient_text"],
                "additives_tags": [],
            }
            hs = score_product(filter_result, product_meta)
            health_score = hs.to_dict()

        enriched.append({
            **p,
            "filter_result": filter_result,
            "health_score": health_score,
        })

    return {
        "query": request.query,
        "results": enriched,
        "total": len(enriched),
        "from_cache": len(raw_results) > 0,
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
