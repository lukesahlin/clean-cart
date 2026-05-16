# search_cache.py
# SQLite-backed cache for Open Food Facts search results.
# Each item search (e.g. "tortilla chips") is cached for CACHE_TTL_HOURS so
# repeated lookups within a session don't hammer the OFF API.

import sqlite3
import json
import hashlib
from datetime import datetime, timedelta
from pathlib import Path

# -- Tunable parameters -------------------------------------------------------

# How long before a cached search result is considered stale
CACHE_TTL_HOURS = 24

CACHE_DB_PATH = Path(__file__).parent / "search_cache.db"

# -- Setup --------------------------------------------------------------------

def _get_conn():
    conn = sqlite3.connect(str(CACHE_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_cache():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS search_results (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_key    TEXT NOT NULL UNIQUE,
            item_name    TEXT NOT NULL,
            results_json TEXT NOT NULL,
            cached_at    TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


# call at import time so the table always exists
init_cache()


# -- Public functions ---------------------------------------------------------

def _make_cache_key(item_name: str) -> str:
    # normalize: lowercase + strip whitespace, then hash for safe key
    normalized = item_name.strip().lower()
    return hashlib.md5(normalized.encode()).hexdigest()


def get_cached_search(item_name: str, ttl_hours: int = CACHE_TTL_HOURS) -> list[dict] | None:
    """
    Returns the cached list of raw product dicts for item_name, or None if
    the entry doesn't exist or is older than ttl_hours.
    """
    key = _make_cache_key(item_name)
    conn = _get_conn()
    row = conn.execute(
        "SELECT results_json, cached_at FROM search_results WHERE cache_key = ?", (key,)
    ).fetchone()
    conn.close()

    if not row:
        return None

    cached_at = datetime.fromisoformat(row["cached_at"])
    if datetime.utcnow() - cached_at > timedelta(hours=ttl_hours):
        return None   # stale -- caller should refresh

    return json.loads(row["results_json"])


def set_cached_search(item_name: str, results: list[dict]) -> None:
    """
    Stores a list of serialized RawProduct dicts in the cache.
    Overwrites any existing entry for the same item.
    """
    key = _make_cache_key(item_name)
    conn = _get_conn()
    conn.execute(
        """INSERT INTO search_results (cache_key, item_name, results_json, cached_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
               results_json = excluded.results_json,
               cached_at    = excluded.cached_at,
               item_name    = excluded.item_name""",
        (key, item_name.strip().lower(), json.dumps(results), datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def invalidate_search(item_name: str) -> None:
    """Force-expire a cached entry so the next request refreshes it."""
    key = _make_cache_key(item_name)
    conn = _get_conn()
    conn.execute("DELETE FROM search_results WHERE cache_key = ?", (key,))
    conn.commit()
    conn.close()


def cache_stats() -> dict:
    """Returns a quick summary of cache contents for the /health endpoint."""
    conn = _get_conn()
    total = conn.execute("SELECT COUNT(*) FROM search_results").fetchone()[0]
    fresh_cutoff = (datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS)).isoformat()
    fresh = conn.execute(
        "SELECT COUNT(*) FROM search_results WHERE cached_at > ?", (fresh_cutoff,)
    ).fetchone()[0]
    conn.close()
    return {"total_entries": total, "fresh_entries": fresh, "ttl_hours": CACHE_TTL_HOURS}
