"""Tests for schema validator and column mapper."""

from __future__ import annotations

import pytest

from extraction.mapper import map_columns, similarity
from extraction.validator import (
    KNOWN_SCHEMAS,
    SchemaMatch,
    ValidationResult,
    find_best_schema,
    validate_against_schema,
)


# ---------------------------------------------------------------------------
# 1. Exact schema match -> MATCH with 1.0 confidence
# ---------------------------------------------------------------------------


class TestExactMatch:
    def test_mercury_csv_exact(self):
        cols = ["date", "description", "amount", "bank_balance"]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0
        assert result.schema_id == "mercury-csv"
        assert result.missing_columns == []
        assert result.extra_columns == []

    def test_bca_rekening_koran_exact(self):
        cols = ["tanggal", "keterangan", "mutasi_debet", "mutasi_kredit", "saldo"]
        result = validate_against_schema(cols, "bca-rekening-koran")
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0
        assert result.missing_columns == []

    def test_generic_invoice_exact(self):
        cols = ["invoice_number", "date", "total", "vendor_name"]
        result = validate_against_schema(cols, "generic-invoice")
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0

    def test_payroll_report_exact(self):
        cols = ["employee_name", "gross_pay", "net_pay", "period"]
        result = validate_against_schema(cols, "payroll-report")
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0

    def test_exact_with_optional_columns(self):
        """Including optional columns should still be MATCH."""
        cols = ["date", "description", "amount", "bank_balance", "status", "category"]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0
        assert result.extra_columns == []


# ---------------------------------------------------------------------------
# 2. Document with extra columns -> DRIFT
# ---------------------------------------------------------------------------


class TestExtraColumns:
    def test_extra_columns_drift(self):
        """All required present + unknown extras -> MATCH (extras don't reduce confidence)."""
        cols = [
            "date",
            "description",
            "amount",
            "bank_balance",
            "custom_field",
            "internal_id",
        ]
        result = validate_against_schema(cols, "mercury-csv")
        # All required are present, so confidence is 1.0 -> MATCH
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0
        assert "custom_field" in result.extra_columns
        assert "internal_id" in result.extra_columns

    def test_extra_columns_with_some_missing(self):
        """Some required missing + extra columns -> DRIFT."""
        # 3 of 4 required present = 75% -> DRIFT
        cols = ["date", "description", "amount", "unknown_col", "another_col"]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.DRIFT
        assert result.confidence == 0.75
        assert "bank_balance" in result.missing_columns
        assert "unknown_col" in result.extra_columns


# ---------------------------------------------------------------------------
# 3. Document with missing required columns -> BREAK
# ---------------------------------------------------------------------------


class TestMissingColumns:
    def test_too_many_missing_break(self):
        """Only 1 of 5 required -> 20% -> BREAK."""
        cols = ["tanggal"]
        result = validate_against_schema(cols, "bca-rekening-koran")
        assert result.status == SchemaMatch.BREAK
        assert result.confidence == 0.2
        assert len(result.missing_columns) == 4

    def test_all_missing_break(self):
        """Zero required columns present -> BREAK with 0.0 confidence."""
        cols = ["foo", "bar", "baz"]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.BREAK
        assert result.confidence == 0.0
        assert len(result.missing_columns) == 4

    def test_invoice_mostly_missing(self):
        """Only date present out of 4 required -> 25% -> BREAK."""
        cols = ["date"]
        result = validate_against_schema(cols, "generic-invoice")
        assert result.status == SchemaMatch.BREAK
        assert result.confidence == 0.25


# ---------------------------------------------------------------------------
# 4. Document with renamed columns -> DRIFT + mapper suggestions
# ---------------------------------------------------------------------------


class TestRenamedColumns:
    def test_renamed_columns_drift_with_suggestions(self):
        """Renamed columns should produce DRIFT with mapper suggestions."""
        # 3/4 required present = 75% -> DRIFT
        # "bank_bal" should map to "bank_balance" via fuzzy match
        cols = ["date", "description", "amount", "bank_bal"]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.DRIFT
        assert result.confidence == 0.75
        assert "bank_balance" in result.missing_columns
        # The mapper should suggest bank_bal -> bank_balance
        assert any("bank_bal" in s and "bank_balance" in s for s in result.suggestions)

    def test_renamed_invoice_columns(self):
        """Renamed invoice columns should get suggestions."""
        # Only 2/4 required -> 50% -> BREAK (no suggestions for BREAK)
        cols = ["inv_number", "dt", "total_amount", "vendor"]
        result = validate_against_schema(cols, "generic-invoice")
        assert result.status == SchemaMatch.BREAK
        # BREAK cases don't generate suggestions
        assert result.suggestions == []

    def test_renamed_with_enough_matches_for_drift(self):
        """3/4 required + renamed column -> DRIFT with suggestions."""
        cols = ["invoice_number", "date", "total", "vendor"]
        result = validate_against_schema(cols, "generic-invoice")
        assert result.status == SchemaMatch.DRIFT
        assert result.confidence == 0.75
        assert "vendor_name" in result.missing_columns
        # "vendor" should map to "vendor_name"
        assert any("vendor" in s and "vendor_name" in s for s in result.suggestions)


# ---------------------------------------------------------------------------
# 5. Completely unrecognized format -> BREAK with no schema match
# ---------------------------------------------------------------------------


class TestUnrecognizedFormat:
    def test_completely_foreign_columns(self):
        """Columns that match nothing -> BREAK."""
        cols = ["alpha", "beta", "gamma", "delta", "epsilon"]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.BREAK
        assert result.confidence == 0.0
        assert result.schema_id == "mercury-csv"

    def test_find_best_schema_no_match(self):
        """When no schema matches at all, find_best_schema returns BREAK with None schema."""
        cols = ["x", "y", "z", "w"]
        result = find_best_schema(cols)
        assert result.status == SchemaMatch.BREAK
        assert result.schema_id is None

    def test_find_best_schema_picks_best(self):
        """find_best_schema should pick the schema with highest confidence."""
        cols = ["date", "description", "amount", "bank_balance"]
        result = find_best_schema(cols)
        assert result.status == SchemaMatch.MATCH
        assert result.schema_id == "mercury-csv"
        assert result.confidence == 1.0


# ---------------------------------------------------------------------------
# 6. Confidence boundary tests (94% vs 95%)
# ---------------------------------------------------------------------------


class TestConfidenceBoundaries:
    def test_exactly_at_match_threshold(self):
        """With 20 required columns, 19 present = 95% -> MATCH."""
        # Build a synthetic schema with 20 required columns
        schema_id = "__test_20"
        KNOWN_SCHEMAS[schema_id] = {
            "required": [f"col_{i}" for i in range(20)],
            "optional": [],
        }
        try:
            # 19 of 20 = 0.95 -> MATCH
            cols = [f"col_{i}" for i in range(19)]
            result = validate_against_schema(cols, schema_id)
            assert result.status == SchemaMatch.MATCH
            assert result.confidence == 0.95
        finally:
            del KNOWN_SCHEMAS[schema_id]

    def test_just_below_match_threshold(self):
        """With 20 required columns, 18 present = 90% -> DRIFT."""
        schema_id = "__test_20b"
        KNOWN_SCHEMAS[schema_id] = {
            "required": [f"col_{i}" for i in range(20)],
            "optional": [],
        }
        try:
            # 18 of 20 = 0.90 -> DRIFT
            cols = [f"col_{i}" for i in range(18)]
            result = validate_against_schema(cols, schema_id)
            assert result.status == SchemaMatch.DRIFT
            assert result.confidence == 0.9
        finally:
            del KNOWN_SCHEMAS[schema_id]

    def test_exactly_at_drift_threshold(self):
        """With 10 required columns, 7 present = 70% -> DRIFT."""
        schema_id = "__test_10"
        KNOWN_SCHEMAS[schema_id] = {
            "required": [f"col_{i}" for i in range(10)],
            "optional": [],
        }
        try:
            cols = [f"col_{i}" for i in range(7)]
            result = validate_against_schema(cols, schema_id)
            assert result.status == SchemaMatch.DRIFT
            assert result.confidence == 0.7
        finally:
            del KNOWN_SCHEMAS[schema_id]

    def test_just_below_drift_threshold(self):
        """With 10 required columns, 6 present = 60% -> BREAK."""
        schema_id = "__test_10b"
        KNOWN_SCHEMAS[schema_id] = {
            "required": [f"col_{i}" for i in range(10)],
            "optional": [],
        }
        try:
            cols = [f"col_{i}" for i in range(6)]
            result = validate_against_schema(cols, schema_id)
            assert result.status == SchemaMatch.BREAK
            assert result.confidence == 0.6
        finally:
            del KNOWN_SCHEMAS[schema_id]

    def test_payroll_3_of_4_required(self):
        """3/4 = 75% -> DRIFT."""
        cols = ["employee_name", "gross_pay", "net_pay"]
        result = validate_against_schema(cols, "payroll-report")
        assert result.status == SchemaMatch.DRIFT
        assert result.confidence == 0.75


# ---------------------------------------------------------------------------
# 7. Mapper unit tests
# ---------------------------------------------------------------------------


class TestMapper:
    def test_exact_match_not_mapped(self):
        """Exact matches should not appear in mapping output."""
        schema = KNOWN_SCHEMAS["mercury-csv"]
        result = map_columns(["date", "description", "amount", "bank_balance"], schema)
        assert result == {}

    def test_fuzzy_match_bank_bal(self):
        """'bank_bal' should map to 'bank_balance'."""
        schema = KNOWN_SCHEMAS["mercury-csv"]
        result = map_columns(["bank_bal"], schema)
        assert "bank_bal" in result
        assert result["bank_bal"] == "bank_balance"

    def test_fuzzy_match_vendor(self):
        """'vendor' should map to 'vendor_name'."""
        schema = KNOWN_SCHEMAS["generic-invoice"]
        result = map_columns(["vendor"], schema)
        assert "vendor" in result
        assert result["vendor"] == "vendor_name"

    def test_no_match_below_threshold(self):
        """Completely unrelated columns should not be mapped."""
        schema = KNOWN_SCHEMAS["mercury-csv"]
        result = map_columns(["xyzzy", "foobar"], schema)
        assert result == {}

    def test_employee_name_variation(self):
        """'emp_name' should map to 'employee_name'."""
        schema = KNOWN_SCHEMAS["payroll-report"]
        result = map_columns(["emp_name"], schema)
        assert "emp_name" in result
        assert result["emp_name"] == "employee_name"

    def test_case_insensitive(self):
        """Mapping should be case-insensitive."""
        schema = KNOWN_SCHEMAS["mercury-csv"]
        result = map_columns(["Bank_Bal"], schema)
        assert "bank_bal" in result

    def test_gross_pay_variation(self):
        """'gross' should map to 'gross_pay'."""
        schema = KNOWN_SCHEMAS["payroll-report"]
        result = map_columns(["gross"], schema)
        assert "gross" in result
        assert result["gross"] == "gross_pay"


# ---------------------------------------------------------------------------
# 8. Similarity function unit tests
# ---------------------------------------------------------------------------


class TestSimilarity:
    def test_identical_strings(self):
        assert similarity("date", "date") == 1.0

    def test_completely_different(self):
        score = similarity("xyz", "abc")
        assert score < 0.3

    def test_similar_strings(self):
        score = similarity("bank_balance", "bank_bal")
        assert score > 0.5

    def test_empty_strings(self):
        assert similarity("", "") == 1.0

    def test_one_empty(self):
        assert similarity("date", "") == 0.0


# ---------------------------------------------------------------------------
# 9. Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    def test_unknown_schema_raises(self):
        with pytest.raises(ValueError, match="Unknown schema_id"):
            validate_against_schema(["date"], "nonexistent-schema")

    def test_empty_columns(self):
        """Empty column list should produce BREAK."""
        result = validate_against_schema([], "mercury-csv")
        assert result.status == SchemaMatch.BREAK
        assert result.confidence == 0.0


# ---------------------------------------------------------------------------
# 10. Case normalisation
# ---------------------------------------------------------------------------


class TestNormalisation:
    def test_uppercase_columns_match(self):
        """Column names should be normalised to lowercase."""
        cols = ["DATE", "DESCRIPTION", "AMOUNT", "BANK_BALANCE"]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0

    def test_whitespace_columns_match(self):
        """Leading/trailing whitespace should be stripped."""
        cols = [" date ", " description", "amount ", " bank_balance "]
        result = validate_against_schema(cols, "mercury-csv")
        assert result.status == SchemaMatch.MATCH
        assert result.confidence == 1.0


# ---------------------------------------------------------------------------
# 11. ValidationResult is a proper dataclass
# ---------------------------------------------------------------------------


class TestValidationResultStructure:
    def test_result_fields(self):
        result = validate_against_schema(
            ["date", "description", "amount", "bank_balance"], "mercury-csv"
        )
        assert isinstance(result, ValidationResult)
        assert isinstance(result.status, SchemaMatch)
        assert isinstance(result.confidence, float)
        assert isinstance(result.matched_columns, list)
        assert isinstance(result.missing_columns, list)
        assert isinstance(result.extra_columns, list)
        assert isinstance(result.suggestions, list)
