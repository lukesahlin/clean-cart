# adapters/walmart.py
# Walmart product search via BlueCart API (https://www.bluecartapi.com)
#
# Much simpler than the old signed Walmart API — just one key.
# Sign up at https://app.bluecartapi.com to get your API key (free tier available).
# Set BLUECART_API_KEY in your .env file.
#
# How it works:
#   GET https://api.bluecartapi.com/request
#     ?api_key=<key>&type=search&search_term=<query>&sort_by=best_match
#
# Response has a `search_results` list, each item has:
#   product.item_id, product.title, product.brand, product.main_image,
#   product.prices.buy_box_prices.price, product.available_online

import os
import re
import logging
from datetime import datetime
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

logger = logging.getLogger(__name__)

# ── Tunable parameters ────────────────────────────────────────────────────────

BLUECART_URL    = "https://api.bluecartapi.com/request"
CACHE_TTL_HOURS = 6
REQUEST_TIMEOUT = 15   # BlueCart can be a bit slower than a direct API
MAX_RESULTS     = 10

# ── Result shape ──────────────────────────────────────────────────────────────

@dataclass
class AvailabilityResult:
    product_name: str
    in_stock: bool
    price: float | None
    store_name: str
    store_branch_id: str
    chain_id: str = "walmart"
    last_checked: str = ""
    source_url: str = ""
    image_url: str = ""
    brand: str = ""
    size: str = ""
    ingredient_text: str = ""

    def __post_init__(self):
        if not self.last_checked:
            self.last_checked = datetime.utcnow().isoformat()

    def to_dict(self):
        return {
            "product_name":    self.product_name,
            "in_stock":        self.in_stock,
            "price":           self.price,
            "store_name":      self.store_name,
            "store_branch_id": self.store_branch_id,
            "chain_id":        self.chain_id,
            "last_checked":    self.last_checked,
            "source_url":      self.source_url,
            "image_url":       self.image_url,
            "brand":           self.brand,
            "size":            self.size,
            "ingredient_text": self.ingredient_text,
        }


# ── In-process cache ──────────────────────────────────────────────────────────

_cache: dict = {}

def _cache_key(query: str) -> str:
    import hashlib
    return hashlib.md5(f"walmart|{query.lower().strip()}".encode()).hexdigest()

def _get_cached(query: str):
    from datetime import timezone
    key = _cache_key(query)
    entry = _cache.get(key)
    if not entry:
        return None
    age = datetime.now(timezone.utc) - datetime.fromisoformat(entry["cached_at"]).replace(tzinfo=timezone.utc)
    if age.total_seconds() > CACHE_TTL_HOURS * 3600:
        del _cache[key]
        return None
    return entry["results"]

def _set_cached(query: str, results: list):
    _cache[_cache_key(query)] = {
        "cached_at": datetime.utcnow().isoformat(),
        "results": results,
    }


# ── Response parser ───────────────────────────────────────────────────────────

def _extract_ingredient_text(product: dict) -> str:
    """
    BlueCart doesn't always return ingredient text in search results, but
    sometimes it shows up in the description or specifications fields.
    We do a best-effort parse here.
    """
    for field_name in ("description", "short_description"):
        val = product.get(field_name, "") or ""
        if "ingredient" in val.lower():
            clean = re.sub(r"<[^>]+>", " ", val)
            m = re.search(r"ingredients?\s*:?\s*(.+?)(?:\.|$)", clean, re.IGNORECASE | re.DOTALL)
            if m:
                return m.group(1).strip()[:600]

    # BlueCart sometimes returns a specifications list like [{name, value}]
    for spec in product.get("specifications", []) or []:
        if "ingredient" in (spec.get("name") or "").lower():
            return (spec.get("value") or "").strip()[:600]

    return ""


def _parse_result(item: dict, store_branch_id: str = "walmart") -> dict:
    """Turn one BlueCart search result item into our standard product dict."""
    # BlueCart nests product data under a "product" key
    product = item.get("product") or item

    title   = product.get("title", "").strip()
    brand   = product.get("brand", "").strip()
    item_id = str(product.get("item_id") or product.get("us_item_id") or "")
    image   = product.get("main_image") or ""

    # price — prefer buy box, fall back to was_price or top-level price
    prices    = product.get("prices") or {}
    buy_box   = prices.get("buy_box_prices") or {}
    price_val = buy_box.get("price") or buy_box.get("was_price") or prices.get("price")

    # in_stock — BlueCart returns available_online or in_store booleans
    in_stock = bool(product.get("available_online") or product.get("in_store", True))

    source_url = f"https://www.walmart.com/ip/{item_id}" if item_id else "https://www.walmart.com"

    ingredient_text = _extract_ingredient_text(product)

    return {
        "product_id":      item_id,
        "product_name":    title,
        "brand":           brand,
        "image_url":       image,
        "price":           float(price_val) if price_val else None,
        "price_str":       f"${float(price_val):.2f}" if price_val else "",
        "in_stock":        in_stock,
        "size":            product.get("weight") or product.get("size") or "",
        "ingredient_text": ingredient_text,
        "store_banner":    "Walmart",
        "source_url":      source_url,
        "chain_id":        "walmart",
    }


# ── OFF ingredient bridge ─────────────────────────────────────────────────────

def _fetch_off_ingredients(upc: str) -> str:
    """
    Look up ingredient text from Open Food Facts using a UPC/barcode.
    BlueCart's item_id maps to Walmart's UPC, which OFF indexes.
    Returns empty string if not found.
    """
    if not upc or not upc.isdigit():
        return ""
    try:
        url = f"https://world.openfoodfacts.org/api/v0/product/{upc}.json"
        resp = httpx.get(url, timeout=6.0, headers={"User-Agent": "CleanCart/1.0"})
        if resp.status_code != 200:
            return ""
        data = resp.json()
        if data.get("status") != 1:
            return ""
        return data.get("product", {}).get("ingredients_text", "") or ""
    except Exception:
        return ""


def _enrich_with_off(results: list[dict]) -> list[dict]:
    """
    For products missing ingredient_text, try to fetch it from OFF
    using the product's UPC concurrently.
    """
    needs_lookup = [(i, r["product_id"]) for i, r in enumerate(results) if not r.get("ingredient_text")]
    if not needs_lookup:
        return results

    ingredient_map = {}
    with ThreadPoolExecutor(max_workers=min(len(needs_lookup), 6)) as pool:
        futures = {pool.submit(_fetch_off_ingredients, upc): upc for _, upc in needs_lookup}
        for future in as_completed(futures, timeout=8):
            upc = futures[future]
            try:
                ingredient_map[upc] = future.result()
            except Exception:
                ingredient_map[upc] = ""

    for idx, upc in needs_lookup:
        text = ingredient_map.get(upc, "")
        if text:
            results[idx]["ingredient_text"] = text

    return results


# ── Main search ───────────────────────────────────────────────────────────────

def search_walmart(query: str, zip_code: str = "99201", store_branch_id: str = "walmart") -> list[dict]:
    """
    Search Walmart products via BlueCart API.
    Returns a list of product dicts compatible with the /shop endpoint.

    Flow: BlueCart gives us product name, price, availability.
    For ingredient data we first try BlueCart's description/specs fields,
    then fall back to Open Food Facts via UPC lookup.
    Results are cached for CACHE_TTL_HOURS hours.
    """
    cached = _get_cached(query)
    if cached is not None:
        logger.info(f"Walmart/BlueCart cache hit: {query!r}")
        return cached

    api_key = os.getenv("BLUECART_API_KEY", "")
    if not api_key:
        logger.warning("BLUECART_API_KEY not set — skipping Walmart search")
        return []

    try:
        params = {
            "api_key":     api_key,
            "type":        "search",
            "search_term": query,
            "sort_by":     "best_match",
        }
        if zip_code and len(zip_code) == 5 and zip_code.isdigit():
            params["customer_zipcode"] = zip_code

        resp = httpx.get(BLUECART_URL, params=params, timeout=REQUEST_TIMEOUT)

        if resp.status_code != 200:
            logger.warning(f"BlueCart returned {resp.status_code} for {query!r}: {resp.text[:200]}")
            return []

        data    = resp.json()
        items   = data.get("search_results") or []
        results = [_parse_result(item, store_branch_id) for item in items[:MAX_RESULTS]]

        # bridge to OFF for any products missing ingredient text
        results = _enrich_with_off(results)

        _set_cached(query, results)
        logger.info(f"Walmart/BlueCart: {len(results)} results for {query!r}")
        return results

    except Exception as e:
        logger.warning(f"BlueCart error for {query!r}: {e}")
        return []


# ── Single availability check (used by /availability endpoint) ────────────────

def check_availability(product_query: str, store_branch_id: str, store_name: str, zip_code: str = "99201") -> AvailabilityResult:
    results = search_walmart(product_query, zip_code, store_branch_id)
    if results:
        r = results[0]
        return AvailabilityResult(
            product_name=r["product_name"],
            in_stock=r["in_stock"],
            price=r["price"],
            store_name=store_name or "Walmart",
            store_branch_id=store_branch_id,
            source_url=r["source_url"],
            image_url=r["image_url"],
            brand=r["brand"],
            size=r["size"],
            ingredient_text=r["ingredient_text"],
        )
    return AvailabilityResult(
        product_name=product_query, in_stock=False, price=None,
        store_name=store_name or "Walmart", store_branch_id=store_branch_id,
        source_url="https://www.walmart.com",
    )
