# ingredient_normalizer.py
# Three-level ingredient normalization pipeline for Clean Cart.
#
# Level 1 — Structured OFF Tags (most reliable)
#   Uses ingredients_tags, additives_tags, ingredients_analysis_tags directly from OFF.
#
# Level 2 — Canonical Alias Matching
#   Normalizes text and checks against our multilingual alias list.
#
# Level 3 — Raw Text Substring Fallback
#   Last resort: simple substring search (same as the old filter_engine approach).
#
# All three levels return the same MatchResult objects so callers don't need
# to care which level found a match.

import json
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from functools import lru_cache

# ── Tunable parameters ────────────────────────────────────────────────────────

# Minimum similarity ratio (0-1) for fuzzy alias matching.
# Lower = more permissive but more false positives.
FUZZY_MATCH_THRESHOLD = 0.88

# Path to canonical ingredient definitions
CANONICAL_DATA_PATH = Path(__file__).parent / "data" / "canonical_ingredients.json"

# ── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class IngredientMatch:
    canonical: str          # e.g. "soybean_oil"
    category: str           # e.g. "seed_oils"
    risk_level: str         # "high", "medium", "low"
    matched_via: str        # "off_tag", "alias_exact", "alias_fuzzy", "raw_text"
    matched_text: str       # the specific alias or tag that triggered the match


@dataclass
class NormalizationResult:
    is_clean: bool
    matches: list[IngredientMatch] = field(default_factory=list)
    checked_categories: list[str] = field(default_factory=list)

    # convenience: list of unique flagged canonical names
    @property
    def flagged_canonicals(self) -> list[str]:
        return list({m.canonical for m in self.matches})

    def to_dict(self) -> dict:
        return {
            "is_clean": self.is_clean,
            "flagged": [
                {
                    "canonical": m.canonical,
                    "category": m.category,
                    "risk_level": m.risk_level,
                    "matched_via": m.matched_via,
                    "matched_text": m.matched_text,
                }
                for m in self.matches
            ],
            "checked_categories": self.checked_categories,
        }


# ── Canonical ingredient registry ────────────────────────────────────────────

class IngredientRegistry:
    """Loads canonical_ingredients.json and builds lookup indexes."""

    def __init__(self, data_path: Path = CANONICAL_DATA_PATH):
        with open(data_path, "r", encoding="utf-8") as f:
            raw = json.load(f)

        self.entries = raw["ingredients"]

        # index: off_tag → entry
        self._tag_index: dict[str, dict] = {}
        # index: normalized alias → entry
        self._alias_index: dict[str, dict] = {}
        # all normalized aliases as list for fuzzy scan
        self._alias_list: list[tuple[str, dict]] = []

        for entry in self.entries:
            for tag in entry.get("off_tags", []):
                self._tag_index[tag.lower()] = entry
            for alias in entry.get("aliases", []):
                normalized = _normalize_text(alias)
                self._alias_index[normalized] = entry
                self._alias_list.append((normalized, entry))

    def lookup_tag(self, tag: str) -> dict | None:
        return self._tag_index.get(tag.lower())

    def lookup_alias_exact(self, normalized_text: str) -> dict | None:
        return self._alias_index.get(normalized_text)

    def lookup_alias_fuzzy(self, normalized_text: str) -> dict | None:
        """Find closest alias with similarity ≥ FUZZY_MATCH_THRESHOLD."""
        best_ratio = 0.0
        best_entry = None
        for alias, entry in self._alias_list:
            ratio = SequenceMatcher(None, normalized_text, alias).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_entry = entry
        if best_ratio >= FUZZY_MATCH_THRESHOLD:
            return best_entry
        return None

    def by_category(self, category: str) -> list[dict]:
        return [e for e in self.entries if e["category"] == category]


# Module-level singleton — load once
_REGISTRY: IngredientRegistry | None = None

def get_registry() -> IngredientRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = IngredientRegistry()
    return _REGISTRY


# ── Text normalization helpers ────────────────────────────────────────────────

def _normalize_text(text: str) -> str:
    """Lowercase, strip punctuation/parens, collapse whitespace."""
    text = text.lower()
    # remove parens content that often wraps clarifications
    text = re.sub(r'\([^)]*\)', ' ', text)
    # strip punctuation except hyphens (meaningful in names like "tert-butyl")
    text = re.sub(r'[^\w\s\-]', ' ', text)
    # collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _split_ingredients(ingredient_text: str) -> list[str]:
    """
    Split raw ingredient text into individual ingredient fragments.
    Handles commas, semicolons, and parenthetical sub-ingredients.
    """
    # replace parens with commas so sub-ingredients get checked individually
    text = re.sub(r'[\(\)\[\]]', ',', ingredient_text)
    # split on comma or semicolon
    parts = re.split(r'[,;]', text)
    return [p.strip() for p in parts if p.strip()]


# ── Main normalization function ───────────────────────────────────────────────

def normalize_product(
    off_product: dict,
    active_categories: list[str],
) -> NormalizationResult:
    """
    Run all three levels of normalization on a product dict from OFF.

    off_product should contain (all optional, we degrade gracefully):
      - ingredients_tags: list of normalized OFF ingredient tags
      - additives_tags: list of additive tags like "en:e129"
      - ingredients_analysis_tags: list of analysis tags
      - ingredients_text: raw text string
    active_categories: list of category keys to check, e.g. ["seed_oils", "harmful_additives"]
    """
    registry = get_registry()
    matches: list[IngredientMatch] = []
    seen_canonicals: set[str] = set()  # avoid duplicate matches

    def add_match(entry: dict, via: str, text: str):
        if entry["canonical"] not in seen_canonicals:
            if entry["category"] in active_categories:
                seen_canonicals.add(entry["canonical"])
                matches.append(IngredientMatch(
                    canonical=entry["canonical"],
                    category=entry["category"],
                    risk_level=entry["risk_level"],
                    matched_via=via,
                    matched_text=text,
                ))

    # ── Level 1: OFF structured tags ─────────────────────────────────────────
    all_tags = []
    all_tags += off_product.get("ingredients_tags", []) or []
    all_tags += off_product.get("additives_tags", []) or []
    all_tags += off_product.get("ingredients_analysis_tags", []) or []

    for tag in all_tags:
        entry = registry.lookup_tag(tag)
        if entry:
            # use first alias as human-readable text instead of raw tag
            readable = entry["aliases"][0] if entry.get("aliases") else entry["canonical"]
            add_match(entry, "off_tag", readable)

    # ── Level 2: Canonical alias matching on ingredient text ─────────────────
    ingredient_text = off_product.get("ingredients_text", "") or ""
    fragments = _split_ingredients(ingredient_text)

    for fragment in fragments:
        normalized_fragment = _normalize_text(fragment)
        if not normalized_fragment:
            continue

        # 2a — exact alias match
        entry = registry.lookup_alias_exact(normalized_fragment)
        if entry:
            add_match(entry, "alias_exact", fragment)
            continue

        # 2b — check if any alias is a substring of this fragment
        # (catches "contains soybean oil" or "oil (soybean, canola)")
        # Require alias >= 8 chars for substring matching to avoid false positives
        # from short words like "oil", "fat", "bha" matching unrelated ingredients.
        for alias_norm, entry in registry._alias_list:
            if (len(alias_norm) >= 8
                    and entry["category"] in active_categories
                    and alias_norm in normalized_fragment):
                add_match(entry, "alias_substring", alias_norm)

        # 2c — fuzzy match (catches OCR errors and alternate spellings)
        if len(normalized_fragment) >= 5:
            entry = registry.lookup_alias_fuzzy(normalized_fragment)
            if entry:
                add_match(entry, "alias_fuzzy", fragment)

    # ── Level 3: Raw text substring fallback ─────────────────────────────────
    # Only runs for categories that produced no Level 1/2 matches.
    # Uses the aliases directly as substring patterns.
    categories_matched = {m.category for m in matches}
    remaining_categories = [c for c in active_categories if c not in categories_matched]

    if remaining_categories:
        normalized_full_text = _normalize_text(ingredient_text)
        for entry in registry.entries:
            if entry["category"] not in remaining_categories:
                continue
            for alias in entry.get("aliases", []):
                alias_norm = _normalize_text(alias)
                if alias_norm and alias_norm in normalized_full_text:
                    add_match(entry, "raw_text", alias)
                    break  # one alias match per ingredient is enough

    return NormalizationResult(
        is_clean=len(matches) == 0,
        matches=matches,
        checked_categories=active_categories,
    )


# ── Convenience wrapper for legacy dict format (matches old filter_engine API) ─

def analyze_product(off_product: dict, user_avoid: list[str] | None = None) -> dict:
    """
    Drop-in replacement for filter_engine.analyze_ingredients().
    Returns a dict compatible with the existing FilterResult shape.
    """
    base_categories = ["seed_oils", "harmful_additives"]
    active_categories = list(base_categories)
    if user_avoid:
        for cat in user_avoid:
            if cat not in active_categories:
                active_categories.append(cat)

    result = normalize_product(off_product, active_categories)

    return {
        "is_clean": result.is_clean,
        "flagged": [
            {"ingredient": m.matched_text, "category": m.category}
            for m in result.matches
        ],
        "checked_categories": result.checked_categories,
    }
