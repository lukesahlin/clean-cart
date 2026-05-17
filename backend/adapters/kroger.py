# adapters/kroger.py
# Checks product availability at Kroger-family stores (Fred Meyer, QFC, Kroger)
# using the official Kroger Developer API — no scraping, no Playwright.
#
# Sign up at https://developer.kroger.com/ to get a client ID and secret.
# Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in your .env file.
#
# How it works:
#   1. OAuth2 client_credentials → bearer token (cached 28 min, expires at 30)
#   2. Locations API → find the Kroger locationId near a zip code
#   3. Products API → search by term + locationId → get price + fulfillment status

import os
import base64
import time
import threading
import httpx
from datetime import datetime
from adapters import AvailabilityResult

# -- Tunable parameters -------------------------------------------------------

REQUEST_TIMEOUT  = 8         # seconds per API call

# Kroger API base
KROGER_BASE_URL  = "https://api.kroger.com/v1"
TOKEN_URL        = f"{KROGER_BASE_URL}/connect/oauth2/token"
LOCATIONS_URL    = f"{KROGER_BASE_URL}/locations"
PRODUCTS_URL     = f"{KROGER_BASE_URL}/products"

# Kroger banner names to search for by chain_id. QFC and Fred Meyer are both
# returned by the Locations API using their banner name.
# Chain codes returned by Kroger's Locations API (filter.chain values)
CHAIN_BANNER_MAP = {
    "fred_meyer": "FRED",
    "qfc":        "QFC",
    "kroger":     "KROGER",
    "king_soopers": "KINGSOOPERS",
    "ralphs":     "RALPHS",
    "smiths":     "SMITHS",
}

# Shared HTTP client — reuses TCP connections across all Kroger API calls
_http_client = httpx.Client(
    timeout=REQUEST_TIMEOUT,
    http2=False,
    limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
)

# Token cache — shared across all calls in this process
_token_cache: dict = {"token": None, "expires_at": 0}
_token_lock = threading.Lock()

# Location ID cache — zip_code → list of (banner, locationId)
_location_cache: dict = {}

# Store discovery cache — avoids duplicate Locations API calls
_store_discovery_cache: dict = {"key": None, "data": None, "ts": 0}

# -- Auth ---------------------------------------------------------------------

def _get_token() -> str:
    """
    Returns a valid bearer token, refreshing if the cached one is within
    2 minutes of expiry. Uses client_credentials flow — no user login needed.
    Thread-safe via lock to prevent duplicate token requests.
    """
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 120:
        return _token_cache["token"]

    with _token_lock:
        now = time.time()
        if _token_cache["token"] and now < _token_cache["expires_at"] - 120:
            return _token_cache["token"]

        client_id     = os.getenv("KROGER_CLIENT_ID", "")
        client_secret = os.getenv("KROGER_CLIENT_SECRET", "")

        if not client_id or not client_secret:
            raise RuntimeError(
                "KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must be set in .env. "
                "Sign up at https://developer.kroger.com/"
            )

        creds   = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers = {"Authorization": f"Basic {creds}", "Content-Type": "application/x-www-form-urlencoded"}
        payload = {"grant_type": "client_credentials", "scope": "product.compact"}

        resp = _http_client.post(TOKEN_URL, headers=headers, data=payload)
        resp.raise_for_status()
        data = resp.json()

        _token_cache["token"]      = data["access_token"]
        _token_cache["expires_at"] = now + data.get("expires_in", 1800)
        return _token_cache["token"]


# -- Location lookup ----------------------------------------------------------

def _find_kroger_location_id(zip_code: str, chain_banner: str = "") -> str | None:
    """
    Finds the nearest Kroger-family store location ID near a zip code.

    If chain_banner is given (e.g. "Fred Meyer", "QFC") it filters by that
    banner first. If nothing is found — or no banner is specified — it falls
    back to searching all Kroger-family stores and returns the closest one.

    Results are cached for the process lifetime since store locations don't change.
    """
    cache_key = f"{zip_code}|{chain_banner}"
    if cache_key in _location_cache:
        return _location_cache[cache_key]

    token = _get_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    def _query(extra_params: dict) -> list:
        params = {
            "filter.zipCode.near": zip_code,
            "filter.radiusInMiles": 25,
            "filter.limit": 10,
            **extra_params,
        }
        resp = _http_client.get(LOCATIONS_URL, headers=headers, params=params)
        if resp.status_code != 200:
            return []
        return resp.json().get("data", [])

    # try the specific banner first if one was given
    locations = []
    if chain_banner:
        locations = _query({"filter.chain": chain_banner})

    # fall back to any Kroger-family store in the area
    if not locations:
        locations = _query({})

    if not locations:
        return None

    # first result is the nearest
    location_id = locations[0].get("locationId")
    _location_cache[cache_key] = location_id
    return location_id



def find_nearby_kroger_stores(zip_code: str = "", limit: int = 5,
                              lat: float = 0, lng: float = 0) -> list[dict]:
    """
    Returns nearby Kroger-family stores as dicts with name, address, lat, lng, chain.
    Uses the Kroger Locations API directly — doesn't need Google Places.
    Prefers lat/lng if provided, falls back to zip code.
    Results are cached for 60 seconds to avoid duplicate calls between
    /discover-stores and /shop.
    """
    cache_key = f"{round(lat,3)}|{round(lng,3)}|{zip_code}"
    now = time.time()
    if (_store_discovery_cache["key"] == cache_key
            and now - _store_discovery_cache["ts"] < 60):
        return _store_discovery_cache["data"]

    try:
        token = _get_token()
    except Exception:
        return []

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    params = {"filter.radiusInMiles": 25, "filter.limit": limit}

    if lat and lng:
        params["filter.latLong.near"] = f"{lat},{lng}"
    elif zip_code:
        params["filter.zipCode.near"] = zip_code
    else:
        return []

    try:
        resp = _http_client.get(LOCATIONS_URL, headers=headers, params=params)
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    banner_names = {"FRED": "Fred Meyer", "QFC": "QFC", "KROGER": "Kroger"}
    results = []
    for loc in resp.json().get("data", []):
        addr = loc.get("address", {})
        geo = loc.get("geolocation", {})
        chain = loc.get("chain", "KROGER")
        results.append({
            "location_id": loc.get("locationId", ""),
            "name": f"{banner_names.get(chain, chain)} — {addr.get('addressLine1', '')}",
            "chain": chain,
            "address": f"{addr.get('addressLine1', '')}, {addr.get('city', '')}",
            "city": addr.get("city", ""),
            "lat": geo.get("latitude", 0),
            "lng": geo.get("longitude", 0),
        })

    _store_discovery_cache["key"] = cache_key
    _store_discovery_cache["data"] = results
    _store_discovery_cache["ts"] = time.time()
    return results


# -- Product search -----------------------------------------------------------

def _search_products(query: str, location_id: str) -> list[dict]:
    """
    Searches Kroger's Products API for a query string scoped to a specific
    location. Returns a list of raw product dicts from the API.
    """
    token = _get_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    params = {
        "filter.term":        query,
        "filter.locationId":  location_id,
        "filter.fulfillment": "csp",    # in-store (vs. delivery-only)
        "filter.limit":       5,
    }

    resp = _http_client.get(PRODUCTS_URL, headers=headers, params=params)
    if resp.status_code != 200:
        return []

    return resp.json().get("data", [])


# -- Store product search (returns multiple results for shop endpoint) --------

def _clean_product_name(raw_name: str, brand: str) -> str:
    """Title-case the ALL-CAPS name Kroger returns and strip redundant brand prefix."""
    if not raw_name:
        return raw_name
    name = raw_name.strip()
    if name == name.upper() and len(name) > 3:
        name = name.title()
    if brand:
        bl = brand.lower()
        nl = name.lower()
        if nl.startswith(bl):
            name = name[len(brand):].lstrip(" -–—")
            if not name:
                name = raw_name.title() if raw_name == raw_name.upper() else raw_name
    return name


def _extract_kroger_ingredients(product: dict) -> str:
    """
    Extract ingredient text directly from Kroger's API response.
    The data lives in nutritionInformation[0].ingredientStatement.
    """
    nutrition = product.get("nutritionInformation")
    if isinstance(nutrition, list) and nutrition:
        statement = nutrition[0].get("ingredientStatement", "") or ""
        return statement.strip()
    return ""


def search_products_at_store(query: str, zip_code: str = "", banner: str = "",
                             limit: int = 10, location_id: str = "") -> list[dict]:
    """
    Search Kroger products at a specific store (by location_id) or the nearest
    Kroger-family store near zip_code.

    Ingredients come directly from Kroger's own nutritionInformation field.
    """
    try:
        if not location_id:
            location_id = _find_kroger_location_id(zip_code, banner)
        if not location_id:
            return []

        token = _get_token()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        params = {
            "filter.term": query,
            "filter.locationId": location_id,
            "filter.fulfillment": "csp",
            "filter.limit": limit,
        }
        resp = _http_client.get(PRODUCTS_URL, headers=headers, params=params)
        if resp.status_code != 200:
            return []

        products = resp.json().get("data", [])

        parsed = []
        for p in products:
            items = p.get("items", [{}])
            item = items[0] if items else {}
            price_info = item.get("price", {})
            price = price_info.get("promo") or price_info.get("regular")
            in_store = (
                item.get("fulfillment", {}).get("csp", False)
                or item.get("fulfillment", {}).get("instore", False)
            )

            upc = p.get("productId", "")
            raw_name = p.get("description", "") if isinstance(p.get("description"), str) else ""
            brand = p.get("brand", "")
            product_name = _clean_product_name(raw_name, brand)

            image_url = ""
            images = p.get("images", [])
            for img in images:
                if img.get("perspective") == "front":
                    sizes = img.get("sizes", [])
                    for sz in sizes:
                        if sz.get("size") == "medium":
                            image_url = sz.get("url", "")
                            break
                if image_url:
                    break
            if not image_url and images:
                sizes = images[0].get("sizes", [])
                if sizes:
                    image_url = sizes[0].get("url", "")

            ingredient_text = _extract_kroger_ingredients(p)

            parsed.append({
                "product_id": upc,
                "product_name": product_name,
                "brand": brand,
                "image_url": image_url,
                "price": float(price) if price else None,
                "price_str": f"${float(price):.2f}" if price else "",
                "in_stock": bool(in_store),
                "size": item.get("size", ""),
                "ingredient_text": ingredient_text,
                "store_banner": banner,
                "zip_code": zip_code,
                "location_id": location_id,
                "source_url": f"https://www.kroger.com/p/{upc}",
                "chain_id": "kroger",
            })

        return parsed

    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Kroger search error ({banner}): {e}")
        return []


# -- Public function ----------------------------------------------------------

def check_availability(product_query: str, store_branch_id: str, store_name: str, zip_code: str = "99201") -> AvailabilityResult:
    """
    Checks if product_query is available at the nearest Kroger-family store
    to zip_code that matches the banner deduced from store_name.

    store_name comes from Google Places (e.g. "Fred Meyer", "QFC - Capitol Hill").
    We use it to pick the right Kroger banner for the location lookup.
    """
    source_url = f"https://www.kroger.com/search?query={product_query}"

    # figure out which banner to use from the store name
    name_lower = store_name.lower()
    if "qfc" in name_lower or "quality food" in name_lower:
        banner = "QFC"
    elif "fred meyer" in name_lower or "fred" in name_lower:
        banner = "FRED"
    else:
        banner = ""   # let the fallback find whatever's closest

    try:
        # step 1: find the Kroger locationId near the user's zip
        location_id = _find_kroger_location_id(zip_code, banner)
        if not location_id:
            return AvailabilityResult(
                product_name=product_query, in_stock=False, price=None,
                store_name=store_name, store_branch_id=store_branch_id,
                chain_id="kroger", last_checked=datetime.utcnow(), source_url=source_url,
            )

        # step 2: search products at that location
        products = _search_products(product_query, location_id)
        if not products:
            return AvailabilityResult(
                product_name=product_query, in_stock=False, price=None,
                store_name=store_name, store_branch_id=store_branch_id,
                chain_id="kroger", last_checked=datetime.utcnow(), source_url=source_url,
            )

        # take the first (best-match) result
        top = products[0]
        product_name = top.get("description", product_query)

        # price lives in items[0].price.regular or .promo
        items = top.get("items", [{}])
        item  = items[0] if items else {}
        price_obj = item.get("price", {})
        price = price_obj.get("promo") or price_obj.get("regular")   # prefer sale price

        # fulfillment: item.fulfillment.csp = True means in-store pickup available
        fulfillment = item.get("fulfillment", {})
        in_stock = bool(fulfillment.get("csp") or fulfillment.get("instore"))

        # If no fulfillment info, fall back to "found in search = likely in stock"
        if not fulfillment:
            in_stock = True

        return AvailabilityResult(
            product_name=product_name,
            in_stock=in_stock,
            price=float(price) if price is not None else None,
            store_name=store_name,
            store_branch_id=store_branch_id,
            chain_id="kroger",
            last_checked=datetime.utcnow(),
            source_url=source_url,
        )

    except Exception as e:
        # API key not configured, network error, rate limit — degrade gracefully
        return AvailabilityResult(
            product_name=product_query, in_stock=False, price=None,
            store_name=store_name, store_branch_id=store_branch_id,
            chain_id="kroger", last_checked=datetime.utcnow(), source_url=source_url,
        )
