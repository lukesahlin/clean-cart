# recommendation_ranker.py
# Ranks clean products by a weighted score so the "cleanest and best-documented"
# products surface first in recommendations.

from filter_engine import analyze_off_product, CATEGORY_MAP
from scoring_engine import score_product, HealthScore
from product_matcher import RawProduct

# ── Tunable scoring weights ────────────────────────────────────────────────────
# Adjust these to change how products are ranked. All weights are positive; higher
# score = better. Final score is the sum of (weight * normalized_value) for each factor.

WEIGHT_INGREDIENT_COUNT = 3.0   # fewer ingredients = cleaner label
WEIGHT_ORGANIC = 2.0            # organic-certified products get a bonus
WEIGHT_COMPLETENESS = 1.5       # better-documented products are more trustworthy
WEIGHT_NUTRISCORE = 1.0         # nutriscore A/B > C > D > E (absent = 0)

# Penalize products with very short ingredient lists (might be incomplete data)
MIN_INGREDIENT_COUNT_FOR_BONUS = 2

# Maximum ingredient count we consider "clean" for normalization purposes
# Products with more than this still get ranked but score 0 on this dimension
MAX_INGREDIENT_COUNT = 30

# ── Scored product ─────────────────────────────────────────────────────────────

class ScoredProduct:
    def __init__(self, product: RawProduct, filter_result: dict, score: float, health_score: HealthScore | None = None):
        self.product = product
        self.filter_result = filter_result  # dict from analyze_off_product
        self.score = score
        self.health_score = health_score

    def to_dict(self) -> dict:
        d = {
            **self.product.to_dict(),
            "score": round(self.score, 2),
            "filter_result": self.filter_result,
            "nova_group": getattr(self.product, "nova_group", None),
        }
        if self.health_score:
            d["health_score"] = self.health_score.to_dict()
        return d


# ── Internal helpers ───────────────────────────────────────────────────────────

def _count_ingredients(ingredient_text: str) -> int:
    # rough count: split on commas, strip, drop empty
    parts = [p.strip() for p in ingredient_text.split(",") if p.strip()]
    return len(parts)


def _nutriscore_to_value(grade: str) -> float:
    # convert nutriscore letter to a 0–1 value
    mapping = {"a": 1.0, "b": 0.75, "c": 0.5, "d": 0.25, "e": 0.0}
    return mapping.get(grade.lower().strip(), 0.0) if grade else 0.0


def _score_product(product: RawProduct) -> float:
    score = 0.0

    # factor 1: ingredient count (fewer = better)
    count = _count_ingredients(product.ingredient_text)
    if count >= MIN_INGREDIENT_COUNT_FOR_BONUS:
        normalized_count = max(0.0, 1.0 - (count / MAX_INGREDIENT_COUNT))
        score += WEIGHT_INGREDIENT_COUNT * normalized_count

    # factor 2: organic certification
    if product.is_organic:
        score += WEIGHT_ORGANIC

    # factor 3: data completeness (0–100 → 0–1)
    completeness_normalized = product.completeness_pct / 100.0
    score += WEIGHT_COMPLETENESS * completeness_normalized

    # factor 4: nutriscore grade
    nutriscore_value = _nutriscore_to_value(product.nutriscore)
    score += WEIGHT_NUTRISCORE * nutriscore_value

    return score


# ── Public function ────────────────────────────────────────────────────────────

def rank_products(
    products: list[RawProduct],
    user_avoid: list[str] | None = None,
    top_n: int = 10,
) -> list[ScoredProduct]:
    """
    Filters out products containing flagged ingredients, then ranks the remaining
    clean products by the weighted score.

    If no clean products exist, falls back to returning the highest-scored products
    regardless of flag status, so the user always sees something useful.

    Returns at most `top_n` ScoredProduct objects, sorted best-first.
    """
    clean = []
    flagged_fallback = []

    for product in products:
        # build an OFF-style dict so the normalizer can use structured tags (Level 1)
        off_dict = {
            "ingredients_text": product.ingredient_text,
            "ingredients_tags": getattr(product, "ingredients_tags", []),
            "additives_tags": getattr(product, "additives_tags", []),
            "ingredients_analysis_tags": getattr(product, "ingredients_analysis_tags", []),
        }
        filter_result = analyze_off_product(off_dict, user_avoid=user_avoid)
        score = _score_product(product)

        # compute health score using the full scoring engine
        product_meta = {
            "is_organic": product.is_organic,
            "nutriscore": product.nutriscore,
            "nova_group": getattr(product, "nova_group", None),
            "ingredient_text": product.ingredient_text,
            "additives_tags": getattr(product, "additives_tags", []),
        }
        health_score = score_product(filter_result, product_meta)
        sp = ScoredProduct(product=product, filter_result=filter_result, score=score, health_score=health_score)

        if filter_result.get("is_clean", False):
            clean.append(sp)
        else:
            flagged_fallback.append(sp)

    # prefer clean products; fall back to best-scored flagged ones if nothing is clean
    pool = clean if clean else flagged_fallback

    # sort descending by health score (more meaningful than the label-quality score)
    pool.sort(key=lambda sp: sp.health_score.score if sp.health_score else sp.score, reverse=True)

    return pool[:top_n]
