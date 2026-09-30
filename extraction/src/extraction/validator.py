"""Extracted data validator.

Validates extracted fields against expected schemas and business rules.

Compares extracted columns against known document schemas and produces
one of three outcomes:

- MATCH  -- >=95% of required columns present
- DRIFT  -- 70-94% of required columns present (extra/renamed columns)
- BREAK  -- <70% match (incompatible format)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


# ---------------------------------------------------------------------------
# Schema match outcomes
# ---------------------------------------------------------------------------


class SchemaMatch(Enum):
    MATCH = "match"  # >=95% columns match known schema
    DRIFT = "drift"  # 70-94% columns match (extra or renamed columns)
    BREAK = "break"  # <70% match (incompatible format)


# ---------------------------------------------------------------------------
# Validation result
# ---------------------------------------------------------------------------


@dataclass
class ValidationResult:
    """Result of validating extracted columns against a known schema."""

    status: SchemaMatch
    schema_id: str | None
    confidence: float  # 0.0 to 1.0
    matched_columns: list[str] = field(default_factory=list)
    missing_columns: list[str] = field(default_factory=list)
    extra_columns: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)  # for DRIFT: column mappings


# ---------------------------------------------------------------------------
# Known schemas (hardcoded for MVP)
# ---------------------------------------------------------------------------

KNOWN_SCHEMAS: dict[str, dict[str, list[str]]] = {
    "bca-rekening-koran": {
        "required": [
            "tanggal",
            "keterangan",
            "mutasi_debet",
            "mutasi_kredit",
            "saldo",
        ],
        "optional": ["cabang", "no_referensi"],
    },
    "mercury-csv": {
        "required": ["date", "description", "amount", "bank_balance"],
        "optional": ["status", "category", "note"],
    },
    "generic-invoice": {
        "required": ["invoice_number", "date", "total", "vendor_name"],
        "optional": ["due_date", "tax", "currency", "line_items"],
    },
    "payroll-report": {
        "required": ["employee_name", "gross_pay", "net_pay", "period"],
        "optional": ["tax_withheld", "deductions", "department"],
    },
}

# Thresholds for schema match classification
_MATCH_THRESHOLD = 0.95
_DRIFT_THRESHOLD = 0.70


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def validate_against_schema(
    columns: list[str],
    schema_id: str,
) -> ValidationResult:
    """Compare extracted columns against a known schema.

    Parameters
    ----------
    columns:
        List of column names extracted from the document.
    schema_id:
        Identifier of the schema to validate against (key in KNOWN_SCHEMAS).

    Returns
    -------
    ValidationResult describing how well the columns match the schema.

    Raises
    ------
    ValueError
        If *schema_id* is not found in KNOWN_SCHEMAS.
    """
    if schema_id not in KNOWN_SCHEMAS:
        raise ValueError(
            f"Unknown schema_id {schema_id!r}. "
            f"Available: {sorted(KNOWN_SCHEMAS)}"
        )

    schema = KNOWN_SCHEMAS[schema_id]
    required: list[str] = schema["required"]
    optional: list[str] = schema.get("optional", [])
    all_schema_cols = set(required) | set(optional)

    # Normalise for comparison
    norm_columns = {c.strip().lower() for c in columns}
    norm_required = {r.lower() for r in required}
    norm_all = {c.lower() for c in all_schema_cols}

    # Matched = columns present in required set
    matched_required = norm_required & norm_columns
    missing_required = sorted(norm_required - norm_columns)

    # Extra = columns not in schema at all
    extra = sorted(norm_columns - norm_all)

    # Confidence = fraction of required columns matched
    if len(norm_required) == 0:
        confidence = 1.0
    else:
        confidence = len(matched_required) / len(norm_required)

    confidence = round(confidence, 4)

    # Classify
    if confidence >= _MATCH_THRESHOLD:
        status = SchemaMatch.MATCH
    elif confidence >= _DRIFT_THRESHOLD:
        status = SchemaMatch.DRIFT
    else:
        status = SchemaMatch.BREAK

    # Build suggestions for DRIFT cases
    suggestions: list[str] = []
    if status == SchemaMatch.DRIFT and extra and missing_required:
        # Defer to mapper for fuzzy suggestions
        from extraction.mapper import map_columns

        mapping = map_columns(list(norm_columns), schema)
        for src, tgt in mapping.items():
            if src not in norm_all:
                suggestions.append(f"{src} -> {tgt}")

    return ValidationResult(
        status=status,
        schema_id=schema_id,
        confidence=confidence,
        matched_columns=sorted(matched_required),
        missing_columns=missing_required,
        extra_columns=extra,
        suggestions=suggestions,
    )


def find_best_schema(columns: list[str]) -> ValidationResult:
    """Try all known schemas and return the best match.

    If no schema reaches DRIFT threshold, returns a BREAK result with
    ``schema_id=None``.
    """
    best: ValidationResult | None = None

    for sid in KNOWN_SCHEMAS:
        result = validate_against_schema(columns, sid)
        if best is None or result.confidence > best.confidence:
            best = result

    assert best is not None  # KNOWN_SCHEMAS is never empty

    if best.status == SchemaMatch.BREAK:
        # Return with schema_id=None to signal no match
        return ValidationResult(
            status=SchemaMatch.BREAK,
            schema_id=None,
            confidence=best.confidence,
            matched_columns=best.matched_columns,
            missing_columns=best.missing_columns,
            extra_columns=best.extra_columns,
            suggestions=[],
        )

    return best
