# availability_cache.py
# SQLite-backed cache for store availability results.
# Every availability check goes through here first -- if the result is fresh
# enough we return it directly, otherwise we hit the store and update the cache.

import sqlite3
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

# -- Tunable parameters -------------------------------------------------------

CACHE_TTL_HOURS = 6
CACHE_DB_PATH = Path(__file__).parent / "availability_cache.db"

# -- Setup --------------------------------------------------------------------

def _get_conn():
    conn = sqlite3.connect(str(CACHE_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_cache():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS availability (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_key     TEXT NOT NULL UNIQUE,
            result_json   TEXT NOT NULL,
            cached_at     TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

# call at import time so the table always exists
init_cache()

# -- Public functions ---------------------------------------------------------

def make_cache_key(product_query, store_branch_id):
    # normalize so "Tortilla Chips" and "tortilla chips" hit the same cache entry
    return f"{product_query.strip().lower()}|{store_branch_id}"


def get_cached(product_query, store_branch_id, ttl_hours=CACHE_TTL_HOURS):
    key = make_cache_key(product_query, store_branch_id)
    conn = _get_conn()
    row = conn.execute(
        "SELECT result_json, cached_at FROM availability WHERE cache_key = ?", (key,)
    ).fetchone()
    conn.close()

    if not row:
        return None

    cached_at = datetime.fromisoformat(row["cached_at"])
    if datetime.utcnow() - cached_at > timedelta(hours=ttl_hours):
        return None   # stale

    return json.loads(row["result_json"])


def set_cached(product_query, store_branch_id, result_dict):
    key = make_cache_key(product_query, store_branch_id)
    conn = _get_conn()
    conn.execute(
        """INSERT INTO availability (cache_key, result_json, cached_at)
           VALUES (?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
               result_json = excluded.result_json,
               cached_at   = excluded.cached_at""",
        (key, json.dumps(result_dict), datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
