# adapters/fred_meyer.py
# Checks product availability at Fred Meyer / Kroger stores via Playwright.
# Fred Meyer is part of the Kroger family and uses the kroger.com search platform.

import re
import json
from datetime import datetime
from adapters import AvailabilityResult

# -- Tunable parameters -------------------------------------------------------

PAGE_LOAD_TIMEOUT_SECONDS = 15
CACHE_TTL_HOURS = 6
REQUEST_DELAY_SECONDS = 2
KROGER_BASE_URL = "https://www.fredmeyer.com"

# -- Public function ----------------------------------------------------------

def check_availability(product_query, store_branch_id, store_name, zip_code="99201"):
    """
    Uses Playwright to search Fred Meyer for the product.
    Fred Meyer / Kroger uses modal-based store selection.
    Returns an AvailabilityResult.
    """
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

            # dismiss cookie/location modal that appears on first load
            page.goto(KROGER_BASE_URL)
            time.sleep(2)
            try:
                page.click('[data-testid="ModalitySelector--zipCodeInput"]', timeout=4000)
                page.fill('[data-testid="ModalitySelector--zipCodeInput"]', zip_code)
                page.press('[data-testid="ModalitySelector--zipCodeInput"]', "Enter")
                time.sleep(2)
                # pick first store result
                page.click('[data-testid="store-option"]:first-child', timeout=4000)
                time.sleep(1)
            except Exception:
                pass  # already has a store set or modal didn't appear

            # search for product
            search_url = f"{KROGER_BASE_URL}/search?query={product_query.replace(' ', '%20')}"
            page.goto(search_url)
            time.sleep(REQUEST_DELAY_SECONDS)

            try:
                page.wait_for_selector('[data-testid="product-card"]', timeout=8000)
                cards = page.query_selector_all('[data-testid="product-card"]')
                if cards:
                    first = cards[0]
                    name_el = first.query_selector('[data-testid="product-title"]')
                    name = name_el.inner_text() if name_el else product_query

                    price_el = first.query_selector('[data-testid="cart-page-item-price"]')
                    price = None
                    if price_el:
                        try:
                            price = float(re.sub(r"[^\d.]", "", price_el.inner_text()))
                        except Exception:
                            pass

                    browser.close()
                    return AvailabilityResult(
                        product_name=name,
                        in_stock=True,
                        price=price,
                        store_name=store_name,
                        store_branch_id=store_branch_id,
                        chain_id="fred_meyer",
                        last_checked=datetime.utcnow(),
                        source_url=search_url,
                    )
            except Exception:
                pass

            page_text = page.content().lower()
            no_results = "no results" in page_text or "0 items" in page_text

            browser.close()
            return AvailabilityResult(
                product_name=product_query,
                in_stock=not no_results,
                price=None,
                store_name=store_name,
                store_branch_id=store_branch_id,
                chain_id="fred_meyer",
                last_checked=datetime.utcnow(),
                source_url=search_url,
            )

    except Exception as e:
        return AvailabilityResult(
            product_name=product_query,
            in_stock=False,
            price=None,
            store_name=store_name,
            store_branch_id=store_branch_id,
            chain_id="fred_meyer",
            last_checked=datetime.utcnow(),
            source_url="",
        )
