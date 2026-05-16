# scoring_engine.py
# Product health scoring engine for Clean Cart.
# Produces a 0-100 score + letter grade + warnings + positives for each product,
# inspired by the Yuka scoring model.
#
# Score breakdown:
#   Penalties (subtract from 100):
#     - seed oils present:           -30 (high weight)
#     - harmful additives/dyes:      -25 per category hit, max -40
#     - artificial sweeteners:       -15
#     - HFCS / corn syrup:           -15
#     - NOVA group 4 (ultra-proc):   -10
#     - high additive count (>5):    -5
#   Bonuses (add to score):
#     + organic certified:           +5
#     + very short ingredient list:  +5 (<=5 ingredients)
#     + nutriscore A or B:           +5
#     + NOVA group 1 (minimally):    +5
#
# Final score is clamped to [0, 100].

from dataclasses import dataclass, field

# ── Tunable weights ────────────────────────────────────────────────────────────

PENALTY_SEED_OILS          = 30
PENALTY_HARMFUL_ADDITIVES  = 25   # per unique additive category hit, capped below
PENALTY_HARMFUL_MAX        = 40   # max penalty for harmful additives
PENALTY_ARTIFICIAL_SWEET   = 15
PENALTY_HFCS               = 15
PENALTY_NOVA4              = 10   # ultra-processed (NOVA 4)
PENALTY_HIGH_ADDITIVE_COUNT = 5   # more than HIGH_ADDITIVE_THRESHOLD additives
HIGH_ADDITIVE_THRESHOLD    = 5

BONUS_ORGANIC              = 5
BONUS_SHORT_INGREDIENT_LIST = 5   # <= SHORT_INGREDIENT_THRESHOLD ingredients
SHORT_INGREDIENT_THRESHOLD = 5
BONUS_GOOD_NUTRISCORE      = 5    # nutriscore A or B
BONUS_NOVA1                = 5    # minimally processed

GRADE_THRESHOLDS = [
    (85, "excellent"),
    (70, "good"),
    (50, "fair"),
    (30, "poor"),
    (0,  "avoid"),
]

# ── Data class ────────────────────────────────────────────────────────────────

@dataclass
class HealthScore:
    score: int                          # 0-100
    grade: str                          # excellent / good / fair / poor / avoid
    warnings: list[str] = field(default_factory=list)
    positives: list[str] = field(default_factory=list)
    breakdown: dict = field(default_factory=dict)  # what contributed to the score

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "grade": self.grade,
            "warnings": self.warnings,
            "positives": self.positives,
            "breakdown": self.breakdown,
        }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _count_ingredients(ingredient_text: str) -> int:
    if not ingredient_text:
        return 0
    parts = [p.strip() for p in ingredient_text.split(",") if p.strip()]
    return len(parts)


def _nutriscore_value(grade: str) -> str:
    # returns "good", "ok", or "bad" bucket for display
    if not grade:
        return "unknown"
    g = grade.lower().strip()
    if g in ("a", "b"):
        return "good"
    if g in ("c",):
        return "ok"
    return "bad"


# ── Main scoring function ─────────────────────────────────────────────────────

def score_product(
    filter_result: dict,
    product_meta: dict,
) -> HealthScore:
    """
    Score a product given:
      filter_result — dict from analyze_off_product() / analyze_ingredients().to_dict()
        Keys: is_clean, flagged (list of {ingredient, category}), checked_categories
      product_meta — dict with optional keys:
        is_organic, nutriscore, nova_group, ingredient_text, additives_tags

    Returns a HealthScore with score 0-100, grade, warnings, and positives.
    """
    score = 100
    warnings = []
    positives = []
    breakdown = {}

    flagged = filter_result.get("flagged", [])
    flagged_categories = {f["category"] for f in flagged}

    # ── Penalties ─────────────────────────────────────────────────────────────

    if "seed_oils" in flagged_categories:
        score -= PENALTY_SEED_OILS
        breakdown["seed_oils"] = -PENALTY_SEED_OILS
        # collect the specific oils found
        oils = list({f["ingredient"] for f in flagged if f["category"] == "seed_oils"})
        warnings.append(f"Contains seed oil{'s' if len(oils) > 1 else ''}: {', '.join(oils[:3])}")

    harmful_hits = [f for f in flagged if f["category"] == "harmful_additives"]
    if harmful_hits:
        penalty = min(PENALTY_HARMFUL_ADDITIVES * len({h["ingredient"] for h in harmful_hits}), PENALTY_HARMFUL_MAX)
        score -= penalty
        breakdown["harmful_additives"] = -penalty
        additives = list({h["ingredient"] for h in harmful_hits})
        warnings.append(f"Artificial dye{'s' if len(additives) > 1 else ''} / preservative{'s' if len(additives) > 1 else ''}: {', '.join(additives[:3])}")

    if "artificial_sweeteners" in flagged_categories:
        score -= PENALTY_ARTIFICIAL_SWEET
        breakdown["artificial_sweeteners"] = -PENALTY_ARTIFICIAL_SWEET
        sweeteners = list({f["ingredient"] for f in flagged if f["category"] == "artificial_sweeteners"})
        warnings.append(f"Artificial sweetener{'s' if len(sweeteners) > 1 else ''}: {', '.join(sweeteners[:2])}")

    if "high_fructose_corn_syrup" in flagged_categories:
        score -= PENALTY_HFCS
        breakdown["hfcs"] = -PENALTY_HFCS
        warnings.append("Contains high-fructose corn syrup or corn syrup")

    # NOVA group penalty (ultra-processing)
    nova_group = product_meta.get("nova_group")
    try:
        nova_group = int(nova_group) if nova_group else None
    except (ValueError, TypeError):
        nova_group = None

    if nova_group == 4:
        score -= PENALTY_NOVA4
        breakdown["nova4"] = -PENALTY_NOVA4
        warnings.append("Ultra-processed food (NOVA group 4)")

    # additive count penalty
    additive_count = len(product_meta.get("additives_tags", []) or [])
    if additive_count > HIGH_ADDITIVE_THRESHOLD:
        score -= PENALTY_HIGH_ADDITIVE_COUNT
        breakdown["high_additive_count"] = -PENALTY_HIGH_ADDITIVE_COUNT
        warnings.append(f"High additive count ({additive_count} additives)")

    # ── Bonuses ───────────────────────────────────────────────────────────────

    if product_meta.get("is_organic"):
        score += BONUS_ORGANIC
        breakdown["organic"] = +BONUS_ORGANIC
        positives.append("Certified organic")

    ingredient_text = product_meta.get("ingredient_text", "") or ""
    ingredient_count = _count_ingredients(ingredient_text)
    if 0 < ingredient_count <= SHORT_INGREDIENT_THRESHOLD:
        score += BONUS_SHORT_INGREDIENT_LIST
        breakdown["short_ingredient_list"] = +BONUS_SHORT_INGREDIENT_LIST
        positives.append(f"Short ingredient list ({ingredient_count} ingredients)")

    nutriscore = (product_meta.get("nutriscore", "") or "").lower().strip()
    if nutriscore in ("a", "b"):
        score += BONUS_GOOD_NUTRISCORE
        breakdown["nutriscore"] = +BONUS_GOOD_NUTRISCORE
        positives.append(f"Good Nutri-Score ({nutriscore.upper()})")

    if nova_group == 1:
        score += BONUS_NOVA1
        breakdown["nova1"] = +BONUS_NOVA1
        positives.append("Minimally processed (NOVA group 1)")

    # if no warnings at all, call it out as a positive
    if not warnings and filter_result.get("is_clean"):
        positives.append("No flagged ingredients detected")

    # ── Finalize ──────────────────────────────────────────────────────────────

    score = max(0, min(100, score))

    grade = "avoid"
    for threshold, label in GRADE_THRESHOLDS:
        if score >= threshold:
            grade = label
            break

    return HealthScore(
        score=score,
        grade=grade,
        warnings=warnings,
        positives=positives,
        breakdown=breakdown,
    )
