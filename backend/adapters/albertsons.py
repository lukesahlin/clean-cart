# adapters/albertsons.py
# Albertsons uses the exact same website platform as Safeway (both owned by
# Albertsons Companies). Only the base URL differs.

import re
from datetime import datetime
from adapters import AvailabilityResult

# -- Tunable parameters -------------------------------------------------------

PAGE_LOAD_TIMEOUT_SECONDS = 15
CACHE_TTL_HOURS = 6
REQUEST_DELAY_SECONDS = 2
ALBERTSONS_BASE_URL = "https://www.albertsons.com"

# -- Public function ----------------------------------------------------------

def check_availability(product_query, store_branch_id, store_name, zip_code="99201"):
    try:
        from playwright.sync_api import sync_playwright
        import time

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )
            page = context.new_page()
            page.set_default_timeout(PAGE_LOAD_TIMEOUT_SECONDS * 1000)

            # set store location
            page.goto(f"{ALBERTSONS_BASE_URL}/shop/store-locator.html?q={zip_code}")
            time.sleep(REQUEST_DELAY_SECONDS)
            try:
                page.wait_for_selector('[data-qa="store-list-item"]', timeout=8000)
                page.click('[data-qa="store-list-item"]:first-child [data-qa="make-my-store"]')
                time.sleep(1)
            except Exception:
                pass

            # search for product
            search_url = f"{ALBERTSONS_BASE_URL}/shop/search-results.html?q={product_query.replace(' ', '+')}"
            page.goto(search_url)
            time.sleep(REQUEST_DELAY_SECONDS)

            try:
                page.wait_for_selector('[data-qa="product-item"]', timeout=8000)
                items = page.query_selector_all('[data-qa="product-item"]')
                if items:
                    first = items[0]
                    name_el = first.query_selector('[data-qa="product-title"]')
                    name = name_el.inner_text() if name_el else product_query
                    price_el = first.query_selector('[data-qa="price-integer"]')
                    price = None
                    if price_el:
                        try:
                            price = float(price_el.inner_text().replace("$", "").strip())
                        except Exception:
                            pass
                    browser.close()
                    return AvailabilityResult(
                        product_name=name, in_stock=True, price=price,
                        store_name=store_name, store_branch_id=store_branch_id,
                        chain_id="albertsons", last_checked=datetime.utcnow(),
                        source_url=search_url,
                    )
            except Exception:
                pass

            page_text = page.content().lower()
            no_results = "no results" in page_text or "0 results" in page_text
            browser.close()
            return AvailabilityResult(
                product_name=product_query, in_stock=not no_results, price=None,
                store_name=store_name, store_branch_id=store_branch_id,
                chain_id="albertsons", last_checked=datetime.utcnow(),
                source_url=search_url,
            )

    except Exception:
        return AvailabilityResult(
            product_name=product_query, in_stock=False, price=None,
            store_name=store_name, store_branch_id=store_branch_id,
            chain_id="albertsons", last_checked=datetime.utcnow(), source_url="",
        )
