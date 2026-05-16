# Deploying Clean Cart to your iPhone

Two services, both free tiers, takes about 20 minutes.
Backend → Railway. Frontend → Vercel.

---

## Prerequisites

- A GitHub account (to push the code)
- The code in a GitHub repo (public or private, both work)

If it's not on GitHub yet, create a repo at github.com, then from the
`Clean Cart` folder run:

```
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/clean-cart.git
git push -u origin main
```

---

## Part 1 — Deploy the backend to Railway

Railway runs your Python/FastAPI server.

1. Go to **railway.app** and sign up with your GitHub account.

2. Click **New Project → Deploy from GitHub repo** and select your repo.

3. Railway will auto-detect the `backend/` folder. If it asks for the root
   directory, set it to `backend`.

4. Once deployed, go to **Settings → Networking → Generate Domain**.
   Copy the URL — it looks like:
   `https://clean-cart-backend.up.railway.app`

5. Go to **Variables** and add these environment variables:

   | Key | Value |
   |-----|-------|
   | `GOOGLE_PLACES_API_KEY` | your Google Places key |
   | `KROGER_CLIENT_ID` | your Kroger API client ID |
   | `KROGER_CLIENT_SECRET` | your Kroger API client secret |
   | `ALLOWED_ORIGINS` | *(leave blank for now, fill in after Vercel step)* |

6. Railway will redeploy automatically. Check the logs — you should see:
   ```
   Uvicorn running on http://0.0.0.0:XXXX
   ```

7. Test it: open `https://your-backend.up.railway.app/health` in your browser.
   You should see `{"status":"ok", ...}`.

---

## Part 2 — Deploy the frontend to Vercel

Vercel builds and serves your React app.

1. Go to **vercel.com** and sign up with your GitHub account.

2. Click **Add New → Project**, import your GitHub repo.

3. Set the **Root Directory** to `frontend`.

4. Under **Environment Variables**, add:

   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://your-backend.up.railway.app` (no trailing slash) |

5. Click **Deploy**. Vercel builds the app and gives you a URL like:
   `https://clean-cart.vercel.app`

6. Copy that Vercel URL, go back to Railway, and add it to the
   `ALLOWED_ORIGINS` variable:
   ```
   ALLOWED_ORIGINS=https://clean-cart.vercel.app
   ```
   Railway will redeploy the backend automatically.

---

## Part 3 — Install on your iPhone

1. On your iPhone, open **Safari** (must be Safari, not Chrome).

2. Go to your Vercel URL: `https://clean-cart.vercel.app`

3. Tap the **Share** button (box with arrow pointing up) at the bottom.

4. Scroll down and tap **"Add to Home Screen"**.

5. Name it "Clean Cart" and tap **Add**.

The app now appears on your home screen with the green icon, opens
full-screen with no browser chrome, and feels like a native app.

---

## Updating the app

Any time you push to GitHub, both Railway and Vercel redeploy automatically.

```
git add .
git commit -m "update"
git push
```

That's it — the app on your phone updates within ~2 minutes.

---

## API Keys you need

### Google Places API (for nearby store search)
1. Go to console.cloud.google.com
2. Create a project → Enable "Places API"
3. Create → API key
4. Free tier covers thousands of requests/month

### Kroger API (for Fred Meyer + QFC availability)
1. Go to developer.kroger.com
2. Sign up → Create an app
3. Request access to: `product.compact` scope
4. Copy Client ID and Client Secret
5. Free tier, no credit card needed

---

## Troubleshooting

**"Network error" in the app after deploying**
→ The `VITE_API_URL` env var is wrong or missing in Vercel. Check it has
  no trailing slash and matches your Railway domain exactly. Redeploy after fixing.

**CORS error in browser console**
→ Go to Railway Variables and make sure `ALLOWED_ORIGINS` has your exact
  Vercel URL. Railway redeploys on save.

**Railway deploy fails**
→ Check that the Root Directory is set to `backend` in Railway settings.
  Look at the build logs for the specific error.

**"Add to Home Screen" not appearing in Safari**
→ Make sure you're using Safari, not Chrome or Firefox. The option only
  appears in Safari on iOS.
