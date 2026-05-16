# adapters/whole_foods.py
# Checks product availability at Whole Foods via their website.
# wholefoodsmarket.com has a product search; uses Playwright since it's client-rendered.

import re
from datetime import datetime
from adapters import AvailabilityResult

# -- Tunable parameters -------------------------------------------------------

PAGE_LOAD_TIMEOUT_SECONDS = 15
CACHE_TTL_HOURS = 6
REQUEST_DELAY_SECONDS = 2
WF_BASE_URL = "https://www.wholefoodsmarket.com"

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

            # Whole Foods store picker: search by zip on the store locator first
            page.goto(f"{WF_BASE_URL}/stores/search?address={zip_code}")
            time.sleep(REQUEST_DELAY_SECONDS)
            try:
                # click "Set as my store" on the first result
                page.wait_for_selector('[data-testid="store-list-item"]', timeout=6000)
                page.click('[data-testid="store-list-item"]:first-child button', timeout=4000)
                time.sleep(1)
            except Exception:
                pass

            # search for product
            search_url = f"{WF_BASE_URL}/products?text={product_query.replace(' ', '+')}"
            page.goto(search_url)
            time.sleep(REQUEST_DELAY_SECONDS)

            try:
                page.wait_for_selector('[data-testid="product-tile"]', timeout=8000)
                tiles = page.query_selector_all('[data-testid="product-tile"]')
                if tiles:
                    first = tiles[0]
                    name_el = first.query_selector('h2, [data-testid="product-title"]')
                    name = name_el.inner_text().strip() if name_el else product_query
                    price_el = first.query_selector('[data-testid="product-price"], .w-pie-c-product-tile__price')
                    price = None
                    if price_el:
                        try:
                            price = float(re.sub(r"[^\d.]", "", price_el.inner_text()))
                        except Exception:
                            pass
                    browser.close()
                    return AvailabilityResult(
                        product_name=name, in_stock=True, price=price,
                        store_name=store_name, store_branch_id=store_branch_id,
                        chain_id="whole_foods", last_checked=datetime.utcnow(),
                        source_url=search_url,
                    )
            except Exception:
                pass

            page_text = page.content().lower()
            no_results = "no results" in page_text or "0 results" in page_text or "no products found" in page_text
            browser.close()
            return AvailabilityResult(
                product_name=product_query, in_stock=not no_results, price=None,
                store_name=store_name, store_branch_id=store_branch_id,
                chain_id="whole_foods", last_checked=datetime.utcnow(),
                source_url=search_url,
            )

    except Exception:
        return AvailabilityResult(
            product_name=product_query, in_stock=False, price=None,
            store_name=store_name, store_branch_id=store_branch_id,
            chain_id="whole_foods", last_checked=datetime.utcnow(), source_url="",
        )
