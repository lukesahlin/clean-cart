# Clean Cart

A web app that takes your grocery list, filters out brands with seed oils and harmful additives, recommends cleaner alternatives, and shows which nearby stores carry them.

## Quick start

### 1. Backend

```powershell
cd backend
pip install -r requirements.txt
playwright install chromium
uvicorn main:app --reload
```

API runs at http://localhost:8000. Docs at http://localhost:8000/docs.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

App runs at http://localhost:5173.

### 3. Google Places API key (for nearby stores)

Without a key the app still works for ingredient filtering and recommendations — store lookup just returns empty.

1. Go to https://console.cloud.google.com
2. Create a project → APIs & Services → Enable **Places API**
3. Create an API key → copy it
4. Create `backend/.env` (copy from `backend/.env.example`):

```
GOOGLE_PLACES_API_KEY=your_key_here
STORE_SEARCH_RADIUS_METERS=8000
```

Restart the backend after adding the key.

---

## How it works

**User flow:**
1. Type grocery items → app finds clean products via Open Food Facts
2. Tap "Find these at stores near you" → browser requests location
3. Google Places finds nearby Walmart, Safeway, Fred Meyer branches
4. Tap "Check stock" → app scrapes each store's website for live availability
5. Shopping plan appears at the bottom, grouped by store

**Filter categories:**

| Category | Always on | Description |
|---|---|---|
| `seed_oils` | ✓ | Canola, soybean, sunflower, corn, vegetable oil, etc. |
| `harmful_additives` | ✓ | Artificial dyes, BHA/BHT, TBHQ, caramel color, etc. |
| `artificial_sweeteners` | optional | Aspartame, sucralose, acesulfame-K, saccharin |
| `high_fructose_corn_syrup` | optional | HFCS, corn syrup |

Edit the lists at the top of `backend/filter_engine.py` to add or remove ingredients without touching app logic.

---

## Project structure

```
clean-cart/
├── backend/
│   ├── main.py                   # FastAPI app + all endpoints
│   ├── filter_engine.py          # Ingredient flagging logic
│   ├── product_matcher.py        # Open Food Facts integration
│   ├── recommendation_ranker.py  # Scoring and ranking clean products
│   ├── nearby_stores.py          # Google Places API integration
│   ├── availability_cache.py     # SQLite cache for store results
│   ├── test_filter_engine.py     # pytest tests
│   ├── requirements.txt
│   ├── .env.example
│   └── adapters/
│       ├── __init__.py           # AvailabilityResult data class
│       ├── walmart.py            # Walmart JSON API adapter
│       ├── safeway.py            # Safeway Playwright adapter
│       └── fred_meyer.py         # Fred Meyer Playwright adapter
└── frontend/
    └── src/
        ├── App.jsx               # Root + screen routing
        ├── api.js                # All backend + geolocation calls
        └── components/
            ├── GroceryList.jsx   # Item input + saved lists
            ├── Results.jsx       # Recommendations + store availability + shopping plan
            ├── ProductDetail.jsx # Ingredient detail modal
            └── Settings.jsx      # Filter preferences
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/recommend` | Clean product picks for a grocery list |
| `GET` | `/autocomplete?q=` | Item name suggestions |
| `GET` | `/categories` | Available filter categories |
| `GET` | `/nearby-stores?lat=&lng=` | Nearby store branches (requires API key) |
| `POST` | `/availability` | Live stock check via store scrapers |
| `GET` | `/health` | Health check + loaded adapters |

## Run tests

```powershell
cd backend
python -m pytest test_filter_engine.py -v
```

## Notes

- Store scrapers are inherently fragile — store websites change. If a scraper breaks, the adapter returns `in_stock: False` gracefully rather than crashing.
- Availability results are cached in `backend/availability_cache.db` for 6 hours to avoid hammering store sites.
- User settings and saved grocery lists are stored in `localStorage` — no account needed.
