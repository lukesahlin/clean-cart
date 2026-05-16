# adapters/walmart.py
# Walmart Open API adapter — uses Walmart's official product search API.
# Docs: https://developer.walmart.com/api/us/mp/items
#
# Auth: Walmart uses a Consumer ID + RSA private key to sign each request.
# Set WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY in your environment.
# Simpler affiliate key (WALMART_API_KEY) is used as fallback.

import os
import time
import base64
import uuid
import re
import logging
from datetime import datetime
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

# ── Tunable parameters ────────────────────────────────────────────────────────

SEARCH_URL      = "https://api.walmart.com/v1/items/search"
CACHE_TTL_HOURS = 6
REQUEST_TIMEOUT = 10
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
            "product_name": self.product_name,
            "in_stock": self.in_stock,
            "price": self.price,
            "store_name": self.store_name,
            "store_branch_id": self.store_branch_id,
            "chain_id": self.chain_id,
            "last_checked": self.last_checked,
            "source_url": self.source_url,
            "image_url": self.image_url,
            "brand": self.brand,
            "size": self.size,
            "ingredient_text": self.ingredient_text,
        }


# ── Auth ──────────────────────────────────────────────────────────────────────

def _make_signature(consumer_id: str, private_key_b64: str, timestamp: str, request_id: str) -> str:
    """RSA-SHA256 signature required by Walmart's signed API."""
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.backends import default_backend

        key_bytes = base64.b64decode(private_key_b64)
        try:
            private_key = serialization.load_der_private_key(key_bytes, password=None, backend=default_backend())
        except Exception:
            private_key = serialization.load_pem_private_key(key_bytes, password=None, backend=default_backend())

        message = f"{consumer_id}\n{timestamp}\n{request_id}\n".encode("utf-8")
        signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())
        return base64.b64encode(signature).decode("utf-8")
    except ImportError:
        logger.error("cryptography package not installed")
        return ""
    except Exception as e:
        logger.error(f"Walmart signature error: {e}")
        return ""


def _signed_headers(consumer_id: str, private_key_b64: str) -> dict:
    timestamp = str(int(time.time() * 1000))
    request_id = str(uuid.uuid4())
    sig = _make_signature(consumer_id, private_key_b64, timestamp, request_id)
    return {
        "WM_SVC.NAME": "Walmart Marketplace",
        "WM_QOS.CORRELATION_ID": request_id,
        "WM_SEC.TIMESTAMP": timestamp,
        "WM_SEC.AUTH_SIGNATURE": sig,
        "WM_CONSUMER.ID": consumer_id,
        "WM_CONSUMER.INTIMESTAMP": timestamp,
        "WM_SEC.KEY_VERSION": "1",
        "Accept": "application/json",
    }


# ── Cache ─────────────────────────────────────────────────────────────────────

_cache: dict = {}

def _cache_key(query: str, zip_code: str) -> str:
    import hashlib
    return hashlib.md5(f"walmart|{query.lower().strip()}|{zip_code}".encode()).hexdigest()

def _get_cached(query: str, zip_code: str):
    from datetime import timezone
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
    _cache[_cache_key(query, zip_code)] = {
        "cached_at": datetime.utcnow().isoformat(),
        "results": results,
    }


# ── Item parser ───────────────────────────────────────────────────────────────

def _parse_item(item: dict, store_branch_id: str = "walmart") -> AvailabilityResult:
    name      = item.get("name", "").strip()
    brand     = item.get("brandName", "").strip()
    size      = item.get("size", "").strip()
    image     = item.get("largeImage") or item.get("thumbnailImage") or ""
    price     = item.get("salePrice") or item.get("msrp")
    item_id   = str(item.get("itemId") or item.get("id") or "")
    source    = f"https://www.walmart.com/ip/{item_id}" if item_id else "https://www.walmart.com"
    in_stock  = bool(item.get("availableOnline", False)) or item.get("stock") in ("Available", "Limited Supply")

    # try to extract ingredients from description fields
    ingredient_text = ""
    for field in ("shortDescription", "longDescription", "description"):
        val = item.get(field) or ""
        if "ingredient" in val.lower():
            clean = re.sub(r"<[^>]+>", " ", val)
            m = re.search(r"ingredients?\s*:?\s*(.+?)(?:\.|$)", clean, re.IGNORECASE | re.DOTALL)
            if m:
                ingredient_text = m.group(1).strip()[:500]
            break

    return AvailabilityResult(
        product_name=name,
        in_stock=in_stock,
        price=float(price) if price else None,
        store_name="Walmart",
        store_branch_id=store_branch_id,
        chain_id="walmart",
        source_url=source,
        image_url=image,
        brand=brand,
        size=size,
        ingredient_text=ingredient_text,
    )


# ── Main search ───────────────────────────────────────────────────────────────

def search_walmart(query: str, zip_code: str = "99201", store_branch_id: str = "walmart") -> list[dict]:
    """Search Walmart products. Uses signed API if credentials are set, affiliate key as fallback."""
    cached = _get_cached(query, zip_code)
    if cached is not None:
        logger.info(f"Walmart cache hit: {query!r}")
        return cached

    consumer_id = os.getenv("WALMART_CONSUMER_ID", "")
    private_key = os.getenv("WALMART_PRIVATE_KEY", "")
    api_key     = os.getenv("WALMART_API_KEY", "")
    results     = []

    # signed API (preferred)
    if consumer_id and private_key:
        try:
            headers = _signed_headers(consumer_id, private_key)
            params  = {"query": query, "numItems": MAX_RESULTS, "responseGroup": "full"}
            resp    = httpx.get(SEARCH_URL, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                results = [_parse_item(i, store_branch_id).to_dict() for i in items[:MAX_RESULTS]]
        except Exception as e:
            logger.warning(f"Walmart signed API error: {e}")

    # affiliate key fallback
    if not results and api_key:
        try:
            params = {"query": query, "apiKey": api_key, "numItems": MAX_RESULTS,
                      "responseGroup": "full", "format": "json"}
            resp = httpx.get(SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                results = [_parse_item(i, store_branch_id).to_dict() for i in items[:MAX_RESULTS]]
        except Exception as e:
            logger.warning(f"Walmart affiliate API error: {e}")

    _set_cached(query, zip_code, results)
    logger.info(f"Walmart: {len(results)} results for {query!r}")
    return results


# ── Single availability check (used by /availability endpoint) ────────────────

def check_availability(product_query: str, store_branch_id: str, store_name: str, zip_code: str) -> AvailabilityResult:
    results = search_walmart(product_query, zip_code, store_branch_id)
    if results:
        r = results[0]
        return AvailabilityResult(**{k: r[k] for k in AvailabilityResult.__dataclass_fields__ if k in r})
    return AvailabilityResult(
        product_name=product_query, in_stock=False, price=None,
        store_name=store_name or "Walmart", store_branch_id=store_branch_id,
        source_url="https://www.walmart.com",
    )
