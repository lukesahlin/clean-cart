# adapters/trader_joes.py
# Trader Joe's has no public online inventory system.
# Instead we return a "usually carries" signal based on whether the product
# category is the kind of thing TJ's stocks -- they're known for clean-label
# private-label products and curated selection.
# The in_stock field means "TJ's typically carries products like this",
# not a live stock check. The UI should make this distinction clear.

from datetime import datetime
from adapters import AvailabilityResult

# -- Tunable parameters -------------------------------------------------------

CACHE_TTL_HOURS = 24   # longer TTL since this is static knowledge, not live data

# Categories TJ's is well known for carrying clean options in
TJS_STRONG_CATEGORIES = [
    "tortilla chip", "chip", "salsa", "hummus", "nut butter", "almond butter",
    "peanut butter", "granola", "cereal", "cracker", "cookie", "bread",
    "pasta sauce", "olive oil", "vinegar", "yogurt", "cheese", "butter",
    "frozen", "soup", "beans", "lentil", "trail mix", "nut", "dried fruit",
    "coffee", "tea", "juice", "sparkling water", "chocolate", "protein bar",
    "popcorn", "jerky", "pickles", "mustard", "hot sauce",
]

# -- Public function ----------------------------------------------------------

def check_availability(product_query, store_branch_id, store_name, zip_code="99201"):
    """
    Returns a 'usually carries' signal rather than a live stock check.
    TJ's sells almost exclusively private-label products so we can't search
    by brand -- but their store-brand versions of common items tend to be
    clean-label. The source_url links to their product search for manual lookup.
    """
    query_lower = product_query.lower()
    usually_carries = any(cat in query_lower for cat in TJS_STRONG_CATEGORIES)

    return AvailabilityResult(
        product_name=f"Trader Joe's {product_query.split()[-1].title()} (store brand)",
        in_stock=usually_carries,
        price=None,
        store_name=store_name,
        store_branch_id=store_branch_id,
        chain_id="trader_joes",
        last_checked=datetime.utcnow(),
        source_url=f"https://www.traderjoes.com/home/search?q={product_query.replace(' ', '%20')}&section=products",
    )
