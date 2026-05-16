# test_filter_engine.py
# Basic tests for the ingredient filter engine — run with: pytest test_filter_engine.py

import pytest
from filter_engine import analyze_ingredients, FilterResult


def test_clean_product_passes():
    # olive oil, salt, and vinegar should all be fine
    result = analyze_ingredients("olive oil, sea salt, apple cider vinegar")
    assert result.is_clean is True
    assert len(result.flagged) == 0


def test_canola_oil_flagged():
    result = analyze_ingredients("enriched flour, canola oil, salt")
    assert result.is_clean is False
    flagged_names = [f.ingredient for f in result.flagged]
    assert "canola oil" in flagged_names


def test_soybean_oil_flagged():
    result = analyze_ingredients("corn, soybean oil, salt")
    assert result.is_clean is False


def test_red_40_flagged():
    result = analyze_ingredients("sugar, water, red 40, citric acid")
    assert result.is_clean is False
    flagged_names = [f.ingredient for f in result.flagged]
    assert "red 40" in flagged_names


def test_multiple_flags():
    # both canola oil and red 40 should show up
    result = analyze_ingredients("canola oil, red 40, salt")
    assert result.is_clean is False
    assert len(result.flagged) >= 2


def test_artificial_sweetener_off_by_default():
    # sucralose should NOT be flagged unless user_avoid includes it
    result = analyze_ingredients("water, sucralose, citric acid")
    flagged_names = [f.ingredient for f in result.flagged]
    assert "sucralose" not in flagged_names


def test_artificial_sweetener_flagged_when_requested():
    result = analyze_ingredients(
        "water, sucralose, citric acid",
        user_avoid=["artificial_sweeteners"]
    )
    assert result.is_clean is False
    flagged_names = [f.ingredient for f in result.flagged]
    assert "sucralose" in flagged_names


def test_hfcs_flagged_when_requested():
    result = analyze_ingredients(
        "corn syrup, high fructose corn syrup, salt",
        user_avoid=["high_fructose_corn_syrup"]
    )
    assert result.is_clean is False
    flagged_names = [f.ingredient for f in result.flagged]
    assert "high fructose corn syrup" in flagged_names


def test_case_insensitive():
    # labels vary in capitalization
    result = analyze_ingredients("CANOLA OIL, Salt, Flour")
    assert result.is_clean is False


def test_vegetable_oil_flagged():
    result = analyze_ingredients("enriched flour, vegetable oil (soybean, palm), salt")
    assert result.is_clean is False
    flagged_names = [f.ingredient for f in result.flagged]
    assert "vegetable oil" in flagged_names or "soybean oil" in flagged_names


def test_result_dict_shape():
    result = analyze_ingredients("canola oil, salt")
    d = result.to_dict()
    assert "is_clean" in d
    assert "flagged" in d
    assert "checked_categories" in d
    assert isinstance(d["flagged"], list)
