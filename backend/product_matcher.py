# product_matcher.py
# Maps a generic grocery item name to real products using Open Food Facts.
#
# Search strategy:
#   Pass 1 — Category search filtered to US products (countries tag en:united-states)
#   Pass 2 — Same category search, global (no country filter), as fallback
#   Pass 3 — Keyword search for products not tagged with the category
#
# Results are scored by origin so US English products always surface first,
# with international products available as fallback when US coverage is thin.

import json
import re
import httpx
from pathlib import Path
from search_cache import get_cached_search, set_cached_search

# ── Tunable parameters ─────────────────────────────────────────────────────────

# Products to fetch per individual API call
OFF_FETCH_LIMIT = 60

# If US-filtered category search returns fewer than this, also run global search
US_MIN_THRESHOLD = 15

# Minimum completeness (0-100) to include a product — kept low for whole foods
MIN_COMPLETENESS = 5

OFF_BASE_URL = "https://world.openfoodfacts.org"

CATEGORY_MAP_PATH = Path(__file__).parent / "data" / "item_categories.json"

# ── Load category map ──────────────────────────────────────────────────────────
with open(CATEGORY_MAP_PATH, "r", encoding="utf-8") as _f:
    _RAW_MAP = json.load(_f)

ITEM_CATEGORY_MAP: dict[str, dict] = _RAW_MAP["items"]

# ── Fields requested from OFF ──────────────────────────────────────────────────
_FIELDS = (
    "product_name,brands,ingredients_text,ingredients_tags,additives_tags,"
    "ingredients_analysis_tags,nova_group,completeness,labels,"
    "image_small_url,image_url,nutriscore_grade,_id,"
    "countries_tags,languages_tags"   # used for US-first sorting
)


# ── RawProduct ─────────────────────────────────────────────────────────────────

class RawProduct:
    def __init__(self, off_data: dict):
        self.barcode          = off_data.get("_id", "")
        self.product_name     = off_data.get("product_name", "").strip()
        self.brand            = off_data.get("brands", "").strip()
        self.ingredient_text  = off_data.get("ingredients_text", "")
        self.ingredients_tags = off_data.get("ingredients_tags", []) or []
        self.additives_tags   = off_data.get("additives_tags", []) or []
        self.ingredients_analysis_tags = off_data.get("ingredients_analysis_tags", []) or []
        self.nova_group       = off_data.get("nova_group")
        self.completeness     = off_data.get("completeness", 0)
        self.completeness_pct = round(self.completeness * 100)
        self.is_organic       = "organic" in (off_data.get("labels", "") or "").lower()
        self.image_url        = off_data.get("image_small_url", "") or off_data.get("image_url", "")
        self.nutriscore       = off_data.get("nutriscore_grade", "")
        self.off_data         = off_data

        # origin metadata — used for US-first prioritisation
        countries = off_data.get("countries_tags", []) or []
        languages = off_data.get("languages_tags", []) or []
        self.is_us_product  = "en:united-states" in countries
        self.has_english    = "en" in languages or not languages  # no lang tag → assume English

    def is_usable(self) -> bool:
        # Need a name and minimum completeness.
        # Ingredient text not required — whole foods (eggs) have none in OFF.
        return bool(self.product_name) and self.completeness_pct >= MIN_COMPLETENESS

    def to_dict(self) -> dict:
        return {
            "barcode":          self.barcode,
            "product_name":     self.product_name,
            "brand":            self.brand,
            "ingredient_text":  self.ingredient_text,
            "completeness_pct": self.completeness_pct,
            "is_organic":       self.is_organic,
            "image_url":        self.image_url,
            "nutriscore":       self.nutriscore,
        }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize_query(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


def _off_get(params: dict) -> list[dict]:
    """Single OFF cgi/search.pl call. Returns list of product dicts."""
    url = f"{OFF_BASE_URL}/cgi/search.pl"
    try:
        response = httpx.get(url, params=params, timeout=18.0)
        response.raise_for_status()
        return response.json().get("products", [])
    except Exception:
        return []


def _category_search(category: str, us_only: bool = False, page_size: int = OFF_FETCH_LIMIT) -> list[dict]:
    """
    Category-based search. When us_only=True adds a second tag filter for
    en:united-states so only US-sold products come back.
    """
    params: dict = {
        "action":         "process",
        "tagtype_0":      "categories",
        "tag_contains_0": "contains",
        "tag_0":          category,
        "fields":         _FIELDS,
        "json":           1,
        "page_size":      page_size,
        "sort_by":        "unique_scans_n",
        "lc":             "en",
    }
    if us_only:
        # AND filter: must also be in the US country list
        params.update({
            "tagtype_1":      "countries",
            "tag_contains_1": "contains",
            "tag_1":          "en:united-states",
        })
    return _off_get(params)


def _keyword_search(keyword: str, us_only: bool = False, page_size: int = OFF_FETCH_LIMIT) -> list[dict]:
    """
    Full-text keyword search. When us_only=True, adds a country tag filter.
    """
    params: dict = {
        "action":       "process",
        "search_terms": keyword,
        "fields":       _FIELDS,
        "json":         1,
        "page_size":    page_size,
        "sort_by":      "unique_scans_n",
        "lc":           "en",
    }
    if us_only:
        params.update({
            "tagtype_0":      "countries",
            "tag_contains_0": "contains",
            "tag_0":          "en:united-states",
        })
    return _off_get(params)


def _deduplicate(products: list[RawProduct]) -> list[RawProduct]:
    seen, unique = set(), []
    for p in products:
        if p.barcode and p.barcode not in seen:
            seen.add(p.barcode)
            unique.append(p)
    return unique


# Non-English word fragments common in French / German / Spanish product names.
# If ANY of these appear as a standalone word in the product name, it's flagged
# as non-English. Keep this list conservative — only words that would NEVER
# appear in an English product name.
_NON_EN_WORDS = {
    # French
    "croustillante","craquante","tartine","saveur","farine","touche","finement",
    "graines","noisette","beurre","fromage","légumes","épices","sarrasin","noir",
    "cacao","lait","sel","aux","les","des","une","avec","sans","goût",
    # Spanish
    "sabor","sin","para","maíz","aceite","galletas","leche","azúcar",
    # German
    "vollkorn","vollmilch","zartbitter","knäckebrot","haferflocken",
    "mit","und","für","von","aus",
    # Other common giveaways
    "biologico","naturel","bio" ,
}

def _origin_score(product: RawProduct) -> int:
    """
    Lower score = shown first.
      0 — US product with English
      1 — non-US product with English
      2 — non-English product
    """
    name_words = set(product.product_name.lower().split())
    is_english = (
        not (name_words & _NON_EN_WORDS)
        and _ascii_ratio(f"{product.product_name} {product.ingredient_text}") >= 0.90
    )
    if product.is_us_product and is_english:
        return 0
    if is_english:
        return 1
    return 2


def _ascii_ratio(text: str) -> float:
    if not text:
        return 1.0
    return sum(1 for c in text if ord(c) < 128) / len(text)


def _is_relevant(product: RawProduct, query_words: set[str], keywords: list[str]) -> bool:
    """
    Checks that the product name contains at least one meaningful word from
    the search query or the mapping keywords. Prevents category searches that
    are too broad from returning totally unrelated products.

    Uses simple stemming: both the keyword and the product name word are
    truncated to their first 5 chars so "chip" matches "chips"/"chippy" etc.
    """
    significant = {w[:5] for w in (query_words | set(keywords)) if len(w) > 3}
    if not significant:
        return True
    name_lower = product.product_name.lower()
    name_stems = {w[:5] for w in name_lower.split() if len(w) > 3}
    # also check as substring for compound words
    return bool(significant & name_stems) or any(kw in name_lower for kw in significant)


# ── Public function ────────────────────────────────────────────────────────────

def fetch_products_for_item(item_name: str) -> list[RawProduct]:
    """
    Returns RawProduct objects for the item, US products first.

    Checks search_cache first (TTL 24h) to avoid hammering the OFF API.

    Strategy (when cache miss):
      1. Category search — US only (fast, high quality when coverage exists)
      2. If < US_MIN_THRESHOLD results, category search — global fallback
      3. Keyword searches — catch products not properly categorised in OFF
      4. Relevance filter — drop clearly unrelated results
      5. Deduplicate → sort US-English first, English second, other last
    """
    normalized = _normalize_query(item_name)

    # -- Cache check ----------------------------------------------------------
    cached_raws = get_cached_search(normalized)
    if cached_raws is not None:
        # reconstruct RawProduct objects from cached OFF dicts
        return [RawProduct(d) for d in cached_raws]

    # -- Cache miss: fetch from OFF -------------------------------------------
    query_words  = set(normalized.split())
    mapping      = ITEM_CATEGORY_MAP.get(normalized)
    all_keywords = mapping.get("keywords", []) if mapping else [normalized]
    categories   = mapping.get("off_categories", []) if mapping else [f"en:{normalized.replace(' ', '-')}"]

    us_raws:     list[dict] = []
    global_raws: list[dict] = []

    # Pass 1: category search, US only
    for cat in categories:
        us_raws.extend(_category_search(cat, us_only=True))

    us_count = len(set(p.get("_id") for p in us_raws if p.get("_id")))

    # Pass 2: global category search (always run — fills gaps and international)
    # We run it regardless so international products are available as fallback.
    for cat in categories:
        global_raws.extend(_category_search(cat, us_only=False))

    # Pass 3: keyword searches (US first, then global if thin)
    for kw in all_keywords[:2]:
        us_raws.extend(_keyword_search(kw, us_only=True))
    if us_count < US_MIN_THRESHOLD:
        for kw in all_keywords[:2]:
            global_raws.extend(_keyword_search(kw, us_only=False))

    # Combine: US results first so deduplication keeps the US version when
    # the same barcode appears in both lists
    all_raws = us_raws + global_raws

    # Wrap and filter
    products = [RawProduct(p) for p in all_raws]
    usable   = [p for p in products if p.is_usable()]

    # Relevance filter
    relevant = [p for p in usable if _is_relevant(p, query_words, all_keywords)]
    if not relevant:
        relevant = usable   # safety net — show something rather than nothing

    # Deduplicate, then sort: US+English → English → other
    deduped  = _deduplicate(relevant)
    sorted_products = sorted(deduped, key=_origin_score)

    # -- Store in cache (save the raw OFF dicts so RawProduct can be rebuilt) --
    set_cached_search(normalized, [p.off_data for p in sorted_products])

    return sorted_products


def get_autocomplete_suggestions(partial: str, limit: int = 8) -> list[str]:
    partial_lower = _normalize_query(partial)
    suggestions = [k for k in ITEM_CATEGORY_MAP if partial_lower in k]
    suggestions.sort(key=lambda s: (not s.startswith(partial_lower), s))
    return suggestions[:limit]
