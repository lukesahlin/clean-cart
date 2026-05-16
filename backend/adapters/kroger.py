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
import httpx
from datetime import datetime
from adapters import AvailabilityResult

# -- Tunable parameters -------------------------------------------------------

CACHE_TTL_HOURS = 6          # how long we cache availability results
REQUEST_TIMEOUT  = 10        # seconds per API call

# Kroger API base
KROGER_BASE_URL  = "https://api.kroger.com/v1"
TOKEN_URL        = f"{KROGER_BASE_URL}/connect/oauth2/token"
LOCATIONS_URL    = f"{KROGER_BASE_URL}/locations"
PRODUCTS_URL     = f"{KROGER_BASE_URL}/products"

# Kroger banner names to search for by chain_id. QFC and Fred Meyer are both
# returned by the Locations API using their banner name.
CHAIN_BANNER_MAP = {
    "fred_meyer": "Fred Meyer",
    "qfc":        "QFC",
    "kroger":     "Kroger",
}

# Token cache — shared across all calls in this process
_token_cache: dict = {"token": None, "expires_at": 0}

# Location ID cache — zip_code → list of (banner, locationId)
_location_cache: dict = {}

# -- Auth ---------------------------------------------------------------------

def _get_token() -> str:
    """
    Returns a valid bearer token, refreshing if the cached one is within
    2 minutes of expiry. Uses client_credentials flow — no user login needed.
    """
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

    # Kroger uses HTTP Basic auth: base64(client_id:client_secret)
    creds   = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    headers = {"Authorization": f"Basic {creds}", "Content-Type": "application/x-www-form-urlencoded"}
    payload = {"grant_type": "client_credentials", "scope": "product.compact"}

    resp = httpx.post(TOKEN_URL, headers=headers, data=payload, timeout=REQUEST_TIMEOUT)
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
        resp = httpx.get(LOCATIONS_URL, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
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


def _find_kroger_location_with_info(zip_code: str, chain_banner: str = "") -> dict | None:
    """
    Like _find_kroger_location_id but returns the full location object
    so callers can see the store name and chain.
    """
    token = _get_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    def _query(extra_params: dict) -> list:
        params = {
            "filter.zipCode.near": zip_code,
            "filter.radiusInMiles": 25,
            "filter.limit": 10,
            **extra_params,
        }
        resp = httpx.get(LOCATIONS_URL, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return []
        return resp.json().get("data", [])

    locations = []
    if chain_banner:
        locations = _query({"filter.chain": chain_banner})
    if not locations:
        locations = _query({})

    return locations[0] if locations else None


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

    resp = httpx.get(PRODUCTS_URL, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
    if resp.status_code != 200:
        return []

    return resp.json().get("data", [])


# -- Store product search (returns multiple results for shop endpoint) --------

def search_products_at_store(query: str, zip_code: str, banner: str = "", limit: int = 10) -> list[dict]:
    """
    Search Kroger products at the nearest Kroger-family store near zip_code.
    If banner is given (e.g. "Fred Meyer", "QFC") it tries that first, then
    falls back to any Kroger-family store in the area.
    Returns a list of dicts with product name, brand, price, ingredients, image, etc.
    Used by the /shop endpoint to get store-sourced product data.
    """
    try:
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
        resp = httpx.get(PRODUCTS_URL, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return []

        products = resp.json().get("data", [])
        results = []
        for p in products:
            # extract price
            items = p.get("items", [{}])
            item = items[0] if items else {}
            price_info = item.get("price", {})
            price = price_info.get("promo") or price_info.get("regular")
            in_store = item.get("fulfillment", {}).get("csp", False) or item.get("fulfillment", {}).get("instore", False)

            # extract ingredients — Kroger includes this in description.ingredients
            description = p.get("description", {}) if isinstance(p.get("description"), dict) else {}
            ingredient_text = (
                description.get("ingredients", "")
                or p.get("ingredients", "")
                or ""
            ).strip()

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

            results.append({
                "product_id": p.get("productId", ""),
                "product_name": p.get("description", "") if isinstance(p.get("description"), str) else p.get("brand", "") + " " + p.get("description", {}).get("short", ""),
                "brand": p.get("brand", ""),
                "image_url": image_url,
                "price": float(price) if price else None,
                "price_str": f"${float(price):.2f}" if price else "",
                "in_stock": bool(in_store),
                "size": item.get("size", ""),
                "ingredient_text": ingredient_text,
                "store_banner": banner,
                "zip_code": zip_code,
                "location_id": location_id,
                "source_url": f"https://www.kroger.com/p/{p.get('productId', '')}",
                "chain_id": "kroger",
            })
        return results

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
    elif "fred meyer" in name_lower:
        banner = "Fred Meyer"
    else:
        banner = "Kroger"   # fallback

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
