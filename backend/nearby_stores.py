# nearby_stores.py
# Finds nearby grocery store branches using the Google Places API.
# Called by the /nearby-stores endpoint in main.py.

import httpx
import os
import logging

logger = logging.getLogger(__name__)

# -- Tunable parameters -------------------------------------------------------

# How far out to search (meters). Overridden by STORE_SEARCH_RADIUS_METERS env var.
DEFAULT_RADIUS_METERS = int(os.getenv("STORE_SEARCH_RADIUS_METERS", "8000"))

# Only chains we have a real product-search API for.
# The map and /shop endpoint will only show these stores — no point
# displaying a Trader Joe's pin if we can't actually search their inventory.
SUPPORTED_CHAINS = {
    # Kroger family — Fred Meyer, QFC, Kroger all use the Kroger Developer API
    "fred meyer":       "kroger",
    "qfc":              "kroger",
    "quality food":     "kroger",
    "kroger":           "kroger",

    # Walmart — via BlueCart API
    "walmart":          "walmart",
}

GOOGLE_PLACES_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

# -- Data class ---------------------------------------------------------------

class NearbyStore:
    def __init__(self, place_id, name, chain_id, address, lat, lng, distance_meters=None):
        self.place_id = place_id
        self.name = name
        self.chain_id = chain_id       # our internal id, e.g. "walmart"
        self.address = address
        self.lat = lat
        self.lng = lng
        self.distance_meters = distance_meters

    def to_dict(self):
        return {
            "place_id": self.place_id,
            "name": self.name,
            "chain_id": self.chain_id,
            "address": self.address,
            "lat": self.lat,
            "lng": self.lng,
            "distance_meters": self.distance_meters,
        }


# -- Internal helpers ---------------------------------------------------------

def _haversine_meters(lat1, lng1, lat2, lng2):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371000
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlam = radians(lng2 - lng1)
    a = sin(dphi/2)**2 + cos(phi1)*cos(phi2)*sin(dlam/2)**2
    return round(2 * R * atan2(sqrt(a), sqrt(1-a)))


def _match_chain(place_name):
    lower = place_name.lower()
    for fragment, chain_id in SUPPORTED_CHAINS.items():
        if fragment in lower:
            return chain_id
    return None


# -- Public function ----------------------------------------------------------

def find_nearby_stores(lat, lng, radius_meters=None, api_key=None):
    """
    Calls Google Places API and returns a list of NearbyStore objects
    for supported grocery chains within the search radius.
    Also returns a debug_info dict so callers can surface errors.
    """
    key = api_key or os.getenv("GOOGLE_PLACES_API_KEY", "")
    if not key or key.strip() in ("", "your_key_here"):
        logger.warning("GOOGLE_PLACES_API_KEY not set or is placeholder")
        return [], {"error": "api_key_missing"}

    radius = radius_meters or DEFAULT_RADIUS_METERS

    params = {
        "location": f"{lat},{lng}",
        "radius": radius,
        "type": "grocery_or_supermarket",
        "key": key,
    }

    try:
        response = httpx.get(GOOGLE_PLACES_URL, params=params, timeout=10.0)
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"Places API HTTP error: {e.response.status_code} — {e.response.text[:200]}")
        return [], {"error": f"http_{e.response.status_code}"}
    except Exception as e:
        logger.error(f"Places API request failed: {e}")
        return [], {"error": str(e)}

    api_status = data.get("status", "UNKNOWN")
    if api_status != "OK" and api_status != "ZERO_RESULTS":
        error_msg = data.get("error_message", "")
        logger.error(f"Places API returned status={api_status}: {error_msg}")
        return [], {"error": api_status, "detail": error_msg}

    all_results = data.get("results", [])
    logger.info(f"Places API returned {len(all_results)} results for lat={lat}, lng={lng}")

    # log all returned place names so we can see what came back
    for p in all_results:
        logger.info(f"  Place: {p.get('name')} — matched chain: {_match_chain(p.get('name',''))}")

    stores = []
    for place in all_results:
        name = place.get("name", "")
        chain_id = _match_chain(name)
        if not chain_id:
            continue   # skip stores we don't have a scraper for

        loc = place.get("geometry", {}).get("location", {})
        place_lat = loc.get("lat", 0)
        place_lng = loc.get("lng", 0)
        distance = _haversine_meters(lat, lng, place_lat, place_lng)
        address = place.get("vicinity", "")

        stores.append(NearbyStore(
            place_id=place.get("place_id", ""),
            name=name,
            chain_id=chain_id,
            address=address,
            lat=place_lat,
            lng=place_lng,
            distance_meters=distance,
        ))

    # sort closest first
    stores.sort(key=lambda s: s.distance_meters)
    return stores, {"status": api_status, "total_places_returned": len(all_results)}
