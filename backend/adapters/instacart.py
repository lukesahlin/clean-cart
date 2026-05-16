# adapters/instacart.py
# Instacart scraper — uses Playwright to search Instacart and intercept
# the internal JSON API responses before they're rendered to HTML.
#
# Strategy:
#   1. Open instacart.com with stealth settings
#   2. Set location via zip code
#   3. Search for the product
#   4. Intercept JSON responses from Instacart's internal search API
#   5. Parse products from the intercepted data
#   6. Run ingredients through the filter engine if available
#
# Note: Instacart ToS prohibits automated access. Use responsibly and cache
# aggressively (CACHE_TTL_HOURS below) to minimize requests.

import json
import re
import asyncio
import logging
from datetime import datetime
from dataclasses import dataclass, field

# ── Tunable parameters ────────────────────────────────────────────────────────

PAGE_LOAD_TIMEOUT_SECONDS = 20
SEARCH_TIMEOUT_SECONDS = 15
CACHE_TTL_HOURS = 6
REQUEST_DELAY_SECONDS = 2
MAX_RESULTS = 10

logger = logging.getLogger(__name__)


# ── Result shape ──────────────────────────────────────────────────────────────

@dataclass
class InstacartProduct:
    product_id: str
    product_name: str
    brand: str
    image_url: str
    price: float | None
    price_str: str
    store_name: str
    store_id: str
    size: str
    ingredient_text: str
    available: bool
    source_url: str
    fetched_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self):
        return {
            "product_id": self.product_id,
            "product_name": self.product_name,
            "brand": self.brand,
            "image_url": self.image_url,
            "price": self.price,
            "price_str": self.price_str,
            "store_name": self.store_name,
            "store_id": self.store_id,
            "size": self.size,
            "ingredient_text": self.ingredient_text,
            "available": self.available,
            "source_url": self.source_url,
            "fetched_at": self.fetched_at,
        }


# ── Simple in-process cache ───────────────────────────────────────────────────

_cache: dict = {}

def _cache_key(query: str, zip_code: str) -> str:
    import hashlib
    return hashlib.md5(f"{query.lower().strip()}|{zip_code}".encode()).hexdigest()

def _get_cached(query: str, zip_code: str):
    from datetime import timezone, timedelta
    key = _cache_key(query, zip_code)
    entry = _cache.get(key)
    if not entry:
        return None
    age = datetime.now(timezone.utc) - datetime.fromisoformat(entry["cached_at"]).replace(tzinfo=timezone.utc)
    if age.total_seconds() > CACHE_TTL_HOURS * 3600:
        del _cache[key]
        return None
    return entry["results"]

def _set_cached(query: str, zip_code: str, results: list):
    key = _cache_key(query, zip_code)
    _cache[key] = {
        "cached_at": datetime.utcnow().isoformat(),
        "results": results,
    }


# ── Parser helpers ────────────────────────────────────────────────────────────

def _parse_price(price_val) -> tuple[float | None, str]:
    """Extract numeric price and display string from various Instacart formats."""
    if price_val is None:
        return None, ""
    if isinstance(price_val, (int, float)):
        return float(price_val), f"${price_val:.2f}"
    s = str(price_val)
    m = re.search(r"[\d]+\.[\d]{2}|[\d]+", s)
    if m:
        numeric = float(m.group())
        return numeric, f"${numeric:.2f}"
    return None, s


def _extract_products_from_json(data: dict | list, store_name: str, store_id: str, query: str) -> list[InstacartProduct]:
    """
    Walk the intercepted JSON blob and extract product records.
    Instacart's API shape varies — we look for common patterns.
    """
    products = []

    # flatten to a single list of item dicts to search through
    candidates = []

    def walk(obj):
        if isinstance(obj, dict):
            # look for item/product nodes
            if any(k in obj for k in ("display_name", "product_id", "name", "item_id")):
                candidates.append(obj)
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(data)

    seen_ids = set()
    for item in candidates:
        pid = str(item.get("product_id") or item.get("item_id") or item.get("id") or "")
        if not pid or pid in seen_ids:
            continue
        seen_ids.add(pid)

        name = (item.get("display_name") or item.get("name") or item.get("product_name") or "").strip()
        if not name:
            continue

        # skip ads / sponsored non-product blobs
        if item.get("ad_id") and not item.get("product_id"):
            continue

        brand = (item.get("brand_name") or item.get("brand") or "").strip()
        image = (item.get("image_url") or item.get("thumbnail_url") or "")
        size = (item.get("size") or item.get("unit_size") or item.get("package_size") or "")

        # price — try several nested structures
        raw_price = (
            item.get("price")
            or item.get("display_price")
            or (item.get("pricing") or {}).get("price")
            or (item.get("pricing") or {}).get("display_price")
        )
        price_num, price_str = _parse_price(raw_price)

        # ingredient text — Instacart sometimes includes this in product details
        ingredients = (
            item.get("ingredients")
            or item.get("ingredient_list")
            or item.get("description", "")
        )
        if isinstance(ingredients, list):
            ingredients = ", ".join(str(i) for i in ingredients)
        ingredients = str(ingredients or "").strip()

        available = item.get("available", True)
        if isinstance(available, str):
            available = available.lower() not in ("false", "out_of_stock", "unavailable")

        source_url = f"https://www.instacart.com/products/{pid}"

        products.append(InstacartProduct(
            product_id=pid,
            product_name=name,
            brand=brand,
            image_url=image,
            price=price_num,
            price_str=price_str,
            store_name=store_name,
            store_id=store_id,
            size=size,
            ingredient_text=ingredients,
            available=bool(available),
            source_url=source_url,
        ))

        if len(products) >= MAX_RESULTS:
            break

    return products


# ── Main scraper ───────────────────────────────────────────────────────────────

async def search_instacart(query: str, zip_code: str = "99201") -> list[InstacartProduct]:
    """
    Search Instacart for a product query near the given zip code.
    Returns a list of InstacartProduct objects.
    Results are cached for CACHE_TTL_HOURS hours.
    """
    cached = _get_cached(query, zip_code)
    if cached is not None:
        logger.info(f"Instacart cache hit: {query!r}")
        return [InstacartProduct(**p) for p in cached]

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.error("Playwright not installed — run: playwright install chromium")
        return []

    products: list[InstacartProduct] = []
    intercepted: list[dict] = []
    store_name = "Instacart"
    store_id = "unknown"

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
            ],
        )

        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/Los_Angeles",
        )

        page = await context.new_page()

        # intercept JSON responses from Instacart's API
        async def handle_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "json" not in ct:
                return
            if not any(kw in url for kw in ("search", "items", "products", "retailer")):
                return
            try:
                body = await response.json()
                intercepted.append({"url": url, "body": body})
                # try to get store name from response
                nonlocal store_name, store_id
                if isinstance(body, dict):
                    retailer = body.get("retailer") or body.get("data", {}).get("retailer") or {}
                    if isinstance(retailer, dict):
                        sn = retailer.get("name") or retailer.get("display_name")
                        si = retailer.get("id") or retailer.get("retailer_id")
                        if sn:
                            store_name = sn
                        if si:
                            store_id = str(si)
            except Exception:
                pass

        page.on("response", handle_response)

        try:
            # navigate to instacart search with zip code hint
            search_url = f"https://www.instacart.com/store/s?k={query.replace(' ', '+')}"
            await page.goto(
                search_url,
                timeout=PAGE_LOAD_TIMEOUT_SECONDS * 1000,
                wait_until="domcontentloaded",
            )

            # give the page time to fire API calls
            await asyncio.sleep(REQUEST_DELAY_SECONDS)

            # try to wait for search results to appear
            try:
                await page.wait_for_selector(
                    '[data-testid="item-card"], [class*="ItemCard"], [class*="item_card"]',
                    timeout=SEARCH_TIMEOUT_SECONDS * 1000,
                )
            except Exception:
                pass  # proceed with whatever we intercepted

            await asyncio.sleep(1)

        except Exception as e:
            logger.warning(f"Instacart page load error: {e}")
        finally:
            await context.close()
            await browser.close()

    # parse all intercepted JSON blobs
    for entry in intercepted:
        found = _extract_products_from_json(entry["body"], store_name, store_id, query)
        for p in found:
            if not any(x.product_id == p.product_id for x in products):
                products.append(p)
        if len(products) >= MAX_RESULTS:
            break

    # cache results (even if empty, to avoid hammering on failure)
    _set_cached(query, zip_code, [p.to_dict() for p in products])
    logger.info(f"Instacart scraped {len(products)} results for {query!r}")
    return products


# ── Sync wrapper for use in FastAPI run_in_executor ──────────────────────────

def search_instacart_sync(query: str, zip_code: str = "99201") -> list[dict]:
    """Sync wrapper — runs the async scraper in a new event loop."""
    try:
        loop = asyncio.new_event_loop()
        results = loop.run_until_complete(search_instacart(query, zip_code))
        return [p.to_dict() for p in results]
    except Exception as e:
        logger.error(f"Instacart search failed: {e}")
        return []
    finally:
        loop.close()
