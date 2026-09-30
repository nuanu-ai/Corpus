"""Document type detector.

Identifies the type of uploaded document (bank statement, invoice, receipt, etc.)
and determines the appropriate extraction strategy.

Detection strategy (in order of priority):
1. Filename patterns — regex matching for common patterns
2. Extension-based — .xlsx, .csv, .pdf, .png/.jpg
3. Content-based — check headers/columns for known patterns (CSV/XLSX)
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class DetectionResult:
    """Result of document type detection."""

    document_type: str  # "bank_statement", "invoice", "payroll_report", etc.
    schema_id: str | None  # matched schema ID or None
    confidence: float  # 0.0 to 1.0
    metadata: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Filename pattern rules
# ---------------------------------------------------------------------------

# Each rule: (compiled regex applied to lowercased stem, document_type, schema_id, metadata)


@dataclass
class _FilenameRule:
    pattern: re.Pattern[str]
    document_type: str
    schema_id: str | None = None
    metadata: dict = field(default_factory=dict)


_FILENAME_RULES: list[_FilenameRule] = [
    # BCA bank statements
    _FilenameRule(
        pattern=re.compile(r"rekening.*koran|bca.*statement", re.IGNORECASE),
        document_type="bank_statement",
        schema_id="bank_statement_bca",
        metadata={"detected_bank": "BCA"},
    ),
    # Mandiri bank statements
    _FilenameRule(
        pattern=re.compile(r"mandiri.*statement", re.IGNORECASE),
        document_type="bank_statement",
        schema_id="bank_statement_mandiri",
        metadata={"detected_bank": "Mandiri"},
    ),
    # Mercury CSV
    _FilenameRule(
        pattern=re.compile(r"mercury", re.IGNORECASE),
        document_type="bank_statement",
        schema_id="bank_statement_mercury",
        metadata={"detected_bank": "Mercury"},
    ),
    # Indonesian tax invoice (faktur pajak)
    _FilenameRule(
        pattern=re.compile(r"faktur.*pajak", re.IGNORECASE),
        document_type="tax_invoice",
        schema_id="tax_invoice_id",
        metadata={"detected_country": "ID"},
    ),
    # Payroll reports
    _FilenameRule(
        pattern=re.compile(r"payroll", re.IGNORECASE),
        document_type="payroll_report",
        schema_id="payroll_report",
    ),
    # Generic invoices
    _FilenameRule(
        pattern=re.compile(r"invoice", re.IGNORECASE),
        document_type="invoice",
        schema_id="invoice_generic",
    ),
    # Profit & Loss / Income statement
    _FilenameRule(
        pattern=re.compile(r"pnl|profit.*loss|income.*statement", re.IGNORECASE),
        document_type="pnl_report",
        schema_id="pnl_report",
    ),
    # Balance sheet
    _FilenameRule(
        pattern=re.compile(r"balance.*sheet", re.IGNORECASE),
        document_type="balance_sheet",
        schema_id="balance_sheet",
    ),
]


# ---------------------------------------------------------------------------
# Extension → document type fallback
# ---------------------------------------------------------------------------

_EXTENSION_TYPE_MAP: dict[str, str] = {
    ".xlsx": "spreadsheet",
    ".xls": "spreadsheet",
    ".csv": "spreadsheet",
    ".pdf": "document",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
}


# ---------------------------------------------------------------------------
# Content-based header detection (CSV)
# ---------------------------------------------------------------------------

# Known header sets that boost confidence and can refine the type.
@dataclass
class _HeaderRule:
    """A set of required column names (lowercased) that indicate a document type."""

    required_columns: frozenset[str]
    document_type: str
    schema_id: str | None = None
    metadata: dict = field(default_factory=dict)


_HEADER_RULES: list[_HeaderRule] = [
    _HeaderRule(
        required_columns=frozenset({"date", "description", "amount"}),
        document_type="bank_statement",
        schema_id=None,
    ),
    _HeaderRule(
        required_columns=frozenset({"date", "amount", "status", "bank description"}),
        document_type="bank_statement",
        schema_id="bank_statement_mercury",
        metadata={"detected_bank": "Mercury"},
    ),
    _HeaderRule(
        required_columns=frozenset({"employee", "gross", "net", "deductions"}),
        document_type="payroll_report",
        schema_id="payroll_report",
    ),
    _HeaderRule(
        required_columns=frozenset({"invoice_number", "total", "due_date"}),
        document_type="invoice",
        schema_id="invoice_generic",
    ),
]


def _detect_csv_headers(content: bytes) -> _HeaderRule | None:
    """Try to parse the first line of a CSV and match against known header sets."""
    try:
        text = content.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text))
        first_row = next(reader, None)
        if first_row is None:
            return None
        headers = frozenset(h.strip().lower() for h in first_row)
        for rule in _HEADER_RULES:
            if rule.required_columns.issubset(headers):
                return rule
    except Exception:
        return None
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_CONFIDENCE_FILENAME_AND_EXT = 0.9
_CONFIDENCE_FILENAME_ONLY = 0.7
_CONFIDENCE_EXT_ONLY = 0.3
_CONFIDENCE_CONTENT_BOOST = 0.2


def detect_document(
    file_path: str,
    content: bytes | None = None,
) -> DetectionResult:
    """Classify a document by examining its filename, extension, and content.

    Parameters
    ----------
    file_path:
        Path (or just filename) of the document.
    content:
        Raw bytes of the file.  When provided, content-based detection is
        attempted for CSV files.

    Returns
    -------
    DetectionResult with the best-guess document type, optional schema_id,
    confidence score, and metadata.
    """
    path = Path(file_path)
    stem = path.stem.lower()
    ext = path.suffix.lower()

    # 1. Filename pattern matching
    filename_match: _FilenameRule | None = None
    for rule in _FILENAME_RULES:
        if rule.pattern.search(stem):
            filename_match = rule
            break

    # 2. Extension lookup
    ext_type = _EXTENSION_TYPE_MAP.get(ext)

    # 3. Content-based detection (CSV only for now)
    header_match: _HeaderRule | None = None
    if content is not None and ext in (".csv",):
        header_match = _detect_csv_headers(content)

    # --- Combine signals into a single result ---

    if filename_match is not None:
        # Mercury specifically requires .csv extension for full confidence
        if filename_match.schema_id == "bank_statement_mercury" and ext != ".csv":
            confidence = _CONFIDENCE_FILENAME_ONLY
        elif ext_type is not None:
            confidence = _CONFIDENCE_FILENAME_AND_EXT
        else:
            confidence = _CONFIDENCE_FILENAME_ONLY

        metadata = dict(filename_match.metadata)

        # Content boost
        if header_match is not None:
            confidence = min(confidence + _CONFIDENCE_CONTENT_BOOST, 1.0)
            metadata.update(header_match.metadata)

        return DetectionResult(
            document_type=filename_match.document_type,
            schema_id=filename_match.schema_id,
            confidence=round(confidence, 2),
            metadata=metadata,
        )

    # No filename match — fall back to content then extension
    if header_match is not None:
        base = _CONFIDENCE_EXT_ONLY if ext_type else 0.2
        confidence = min(base + _CONFIDENCE_CONTENT_BOOST, 1.0)
        return DetectionResult(
            document_type=header_match.document_type,
            schema_id=header_match.schema_id,
            confidence=round(confidence, 2),
            metadata=dict(header_match.metadata),
        )

    if ext_type is not None:
        return DetectionResult(
            document_type=ext_type,
            schema_id=None,
            confidence=_CONFIDENCE_EXT_ONLY,
            metadata={"extension": ext},
        )

    # Completely unknown
    return DetectionResult(
        document_type="unknown",
        schema_id=None,
        confidence=0.0,
        metadata={"extension": ext} if ext else {},
    )
