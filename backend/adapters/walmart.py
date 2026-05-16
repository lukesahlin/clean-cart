# adapters/walmart.py
# Checks product availability at a Walmart store via their internal search API.
# Walmart's website calls a JSON search endpoint we can hit directly --
# much faster than rendering the full page with Playwright.

import httpx
import re
from datetime import datetime
from adapters import AvailabilityResult

# -- Tunable parameters -------------------------------------------------------

PAGE_LOAD_TIMEOUT_SECONDS = 15
CACHE_TTL_HOURS = 6
REQUEST_DELAY_SECONDS = 2

# Walmart's internal search endpoint (discovered via browser network tab)
WALMART_SEARCH_URL = "https://www.walmart.com/search"

# Headers that make us look like a real browser request
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
}

# -- Public function ----------------------------------------------------------

def check_availability(product_query, store_branch_id, store_name, zip_code="99201"):
    """
    Searches Walmart for the product and returns an AvailabilityResult.
    Uses the JSON data embedded in Walmart's search page (next.js __NEXT_DATA__).
    Falls back to checking if any results appear in the HTML.

    zip_code is used to set the store location context.
    """
    search_url = f"{WALMART_SEARCH_URL}?q={httpx.URL(product_query)}&stores={zip_code}"

    try:
        with httpx.Client(headers=REQUEST_HEADERS, follow_redirects=True, timeout=PAGE_LOAD_TIMEOUT_SECONDS) as client:
            # set store location via cookies/params
            response = client.get(
                WALMART_SEARCH_URL,
                params={"q": product_query, "affinityOverride": zip_code},
            )
            response.raise_for_status()
            html = response.text

        # Walmart embeds product data in a __NEXT_DATA__ JSON blob
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.DOTALL)
        if match:
            import json
            next_data = json.loads(match.group(1))
            items = (
                next_data
                .get("props", {})
                .get("pageProps", {})
                .get("initialData", {})
                .get("searchResult", {})
                .get("itemStacks", [{}])[0]
                .get("items", [])
            )

            for item in items[:5]:
                name = item.get("name", "")
                price_info = item.get("priceInfo", {})
                current_price = price_info.get("currentPrice", {}).get("price")
                in_stock = item.get("availabilityStatus", "") == "IN_STOCK"

                if name:
                    return AvailabilityResult(
                        product_name=name,
                        in_stock=in_stock,
                        price=current_price,
                        store_name=store_name,
                        store_branch_id=store_branch_id,
                        chain_id="walmart",
                        last_checked=datetime.utcnow(),
                        source_url=f"https://www.walmart.com/search?q={product_query}",
                    )

        # fallback: if we got HTML back but couldn't parse JSON, assume results exist
        # if the page contains typical "no results" text, mark as out of stock
        no_results = "no results for" in html.lower() or "0 results" in html.lower()

        return AvailabilityResult(
            product_name=product_query,
            in_stock=not no_results,
            price=None,
            store_name=store_name,
            store_branch_id=store_branch_id,
            chain_id="walmart",
            last_checked=datetime.utcnow(),
            source_url=f"https://www.walmart.com/search?q={product_query}",
        )

    except Exception as e:
        # network error, timeout, etc. -- return unknown rather than crashing
        return AvailabilityResult(
            product_name=product_query,
            in_stock=False,
            price=None,
            store_name=store_name,
            store_branch_id=store_branch_id,
            chain_id="walmart",
            last_checked=datetime.utcnow(),
            source_url="",
        )
