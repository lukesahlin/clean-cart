# filter_engine.py
# Ingredient filtering for Clean Cart.
#
# This module now delegates to ingredient_normalizer.py which runs a
# three-level pipeline:
#   Level 1 — structured OFF tags (ingredients_tags, additives_tags, etc.)
#   Level 2 — canonical alias matching (multilingual, fuzzy)
#   Level 3 — raw text substring fallback
#
# The lists below are kept for documentation and as the source of truth for
# what the canonical_ingredients.json covers. Edit the JSON, not these lists,
# to add new items — these exist so it's easy to see what we filter at a glance.

# ── What we currently filter (edit canonical_ingredients.json to add/remove) ─

SEED_OILS = [
    "canola oil", "soybean oil", "sunflower oil", "safflower oil",
    "corn oil", "cottonseed oil", "grapeseed oil", "rice bran oil",
    "vegetable oil", "palm oil",
    "hydrogenated oil", "partially hydrogenated oil",
]

HARMFUL_ADDITIVES = [
    "red 40", "yellow 5", "yellow 6", "blue 1", "blue 2", "red 3", "green 3",
    "bha", "bht", "tbhq", "propyl gallate",
    "sodium nitrite", "sodium nitrate", "potassium bromate",
    "caramel color", "caramel colour",
]

ARTIFICIAL_SWEETENERS = [
    "aspartame", "sucralose", "acesulfame potassium", "acesulfame-k",
    "saccharin", "neotame",
]

HIGH_FRUCTOSE_CORN_SYRUP = [
    "high fructose corn syrup", "high-fructose corn syrup",
    "high fructose corn", "hfcs",
    "corn syrup", "glucose-fructose syrup",
]

# ── Dietary / allergen filter lists (opt-in from Settings) ────────────────────

GLUTEN_INGREDIENTS = [
    "wheat", "wheat flour", "whole wheat", "barley", "rye", "spelt",
    "semolina", "malt", "barley malt", "gluten", "vital wheat gluten",
]

DAIRY_INGREDIENTS = [
    "milk", "butter", "cream", "cheese", "whey", "casein", "lactose",
    "yogurt", "ghee", "sodium caseinate", "milk protein",
]

NUT_INGREDIENTS = [
    "peanuts", "almonds", "cashews", "walnuts", "pecans", "hazelnuts",
    "pistachios", "macadamia nuts", "brazil nuts", "pine nuts",
    "peanut butter", "almond flour",
]

EGG_INGREDIENTS = [
    "eggs", "egg", "egg yolk", "egg white", "albumin", "ovalbumin",
]

# Maps category key → list above (used by Settings screen and /categories endpoint)
CATEGORY_MAP = {
    "seed_oils": SEED_OILS,
    "harmful_additives": HARMFUL_ADDITIVES,
    "artificial_sweeteners": ARTIFICIAL_SWEETENERS,
    "high_fructose_corn_syrup": HIGH_FRUCTOSE_CORN_SYRUP,
    # dietary / allergen — opt-in
    "gluten": GLUTEN_INGREDIENTS,
    "dairy": DAIRY_INGREDIENTS,
    "nuts": NUT_INGREDIENTS,
    "eggs": EGG_INGREDIENTS,
}

# ── Compatibility layer ───────────────────────────────────────────────────────

from ingredient_normalizer import analyze_product as _analyze_product
from dataclasses import dataclass


@dataclass
class FlaggedIngredient:
    """Represents a single flagged ingredient — matches old API shape."""
    ingredient: str
    category: str


class FilterResult:
    """
    Backward-compatible result object returned by analyze_ingredients().
    Tests and callers can use .is_clean, .flagged, and .to_dict() as before.
    """
    def __init__(self, result_dict: dict):
        self.is_clean: bool = result_dict["is_clean"]
        self.flagged: list[FlaggedIngredient] = [
            FlaggedIngredient(ingredient=f["ingredient"], category=f["category"])
            for f in result_dict.get("flagged", [])
        ]
        self.checked_categories: list[str] = result_dict.get("checked_categories", [])

    def to_dict(self) -> dict:
        return {
            "is_clean": self.is_clean,
            "flagged": [{"ingredient": f.ingredient, "category": f.category} for f in self.flagged],
            "checked_categories": self.checked_categories,
        }


# ── Public API ────────────────────────────────────────────────────────────────

def analyze_ingredients(ingredient_text: str, user_avoid: list[str] | None = None) -> FilterResult:
    """
    Legacy text-only interface — returns a FilterResult object for backward compatibility.
    Uses Level 2/3 normalization only (no OFF structured tags available from raw text).
    """
    off_product = {"ingredients_text": ingredient_text}
    result_dict = _analyze_product(off_product, user_avoid=user_avoid)
    return FilterResult(result_dict)


def analyze_off_product(off_product: dict, user_avoid: list[str] | None = None) -> dict:
    """
    Full three-level analysis for a product dict from Open Food Facts.
    Returns a plain dict (used by recommendation_ranker and main.py).
    off_product should include ingredients_tags, additives_tags,
    ingredients_analysis_tags, and ingredients_text.
    """
    return _analyze_product(off_product, user_avoid=user_avoid)
