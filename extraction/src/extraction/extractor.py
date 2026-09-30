"""Format-specific document data extraction.

Reads raw files and outputs structured records for CSV, XLSX, PDF,
and image formats.  Each extractor auto-detects nuances (delimiter,
BOM, merged cells) and returns a uniform ExtractionResult.

Image extraction is a stub — returns an empty result with a warning
that OCR/Vision processing is required.
"""

from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class ExtractionResult:
    """Uniform output from any format-specific extractor."""

    records: list[dict]          # extracted data rows
    format: str                  # "xlsx", "csv", "pdf", "image"
    row_count: int
    dedup_hash: str              # SHA-256 of file content for duplicate detection
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _file_hash(file_path: str) -> str:
    """Return SHA-256 hex digest of the file's raw bytes."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _strip_bom(text: str) -> str:
    """Remove UTF-8 BOM if present."""
    if text.startswith("\ufeff"):
        return text[1:]
    return text


def _detect_delimiter(sample: str) -> str:
    """Auto-detect CSV delimiter from a text sample.

    Checks for semicolon, tab, then falls back to comma.
    """
    # Count occurrences of common delimiters in the first few lines
    lines = sample.split("\n", 5)[:5]
    joined = "\n".join(lines)

    # Semicolons are used widely in European locales
    semicolons = joined.count(";")
    tabs = joined.count("\t")
    commas = joined.count(",")

    if semicolons > commas and semicolons > tabs:
        return ";"
    if tabs > commas and tabs > semicolons:
        return "\t"
    return ","


# ---------------------------------------------------------------------------
# CSV extraction
# ---------------------------------------------------------------------------


def extract_csv(file_path: str) -> ExtractionResult:
    """Extract data from a CSV file.

    Features:
    - Auto-detect delimiter (comma, semicolon, tab)
    - Handle UTF-8 BOM markers
    - Strip whitespace from headers
    - Return list of dicts (one per row)
    """
    dedup_hash = _file_hash(file_path)
    warnings: list[str] = []

    raw = Path(file_path).read_bytes()
    text = raw.decode("utf-8-sig")  # handles BOM transparently
    text = _strip_bom(text)  # extra guard for non-standard BOM remnants

    if not text.strip():
        return ExtractionResult(
            records=[],
            format="csv",
            row_count=0,
            dedup_hash=dedup_hash,
            warnings=["Empty CSV file"],
        )

    delimiter = _detect_delimiter(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)

    # Strip whitespace from fieldnames
    if reader.fieldnames:
        reader.fieldnames = [h.strip() for h in reader.fieldnames]

    records: list[dict] = []
    for row in reader:
        # Strip whitespace from values and keys
        cleaned = {k.strip() if k else k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
        records.append(cleaned)

    return ExtractionResult(
        records=records,
        format="csv",
        row_count=len(records),
        dedup_hash=dedup_hash,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# XLSX extraction
# ---------------------------------------------------------------------------


def extract_xlsx(file_path: str, sheet_name: str | None = None) -> ExtractionResult:
    """Extract data from an XLSX file.

    Features:
    - Read first sheet by default (or a named sheet)
    - Handle merged cells (use top-left cell value)
    - Skip completely empty rows
    - Return list of dicts keyed by header row
    """
    try:
        import openpyxl
    except ImportError as exc:
        raise ImportError(
            "openpyxl is required for XLSX extraction. "
            "Install it with: pip install openpyxl"
        ) from exc

    dedup_hash = _file_hash(file_path)
    warnings: list[str] = []

    wb = openpyxl.load_workbook(file_path, data_only=True)

    if sheet_name:
        if sheet_name not in wb.sheetnames:
            return ExtractionResult(
                records=[],
                format="xlsx",
                row_count=0,
                dedup_hash=dedup_hash,
                warnings=[f"Sheet '{sheet_name}' not found. Available: {wb.sheetnames}"],
            )
        ws = wb[sheet_name]
    else:
        ws = wb.active

    if ws is None:
        return ExtractionResult(
            records=[],
            format="xlsx",
            row_count=0,
            dedup_hash=dedup_hash,
            warnings=["No active sheet found"],
        )

    # Unmerge cells: copy the top-left value into each merged cell
    for merge_range in list(ws.merged_cells.ranges):
        min_row = merge_range.min_row
        min_col = merge_range.min_col
        top_left_value = ws.cell(row=min_row, column=min_col).value
        ws.unmerge_cells(str(merge_range))
        for row in range(merge_range.min_row, merge_range.max_row + 1):
            for col in range(merge_range.min_col, merge_range.max_col + 1):
                ws.cell(row=row, column=col).value = top_left_value

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return ExtractionResult(
            records=[],
            format="xlsx",
            row_count=0,
            dedup_hash=dedup_hash,
            warnings=["Empty spreadsheet"],
        )

    # First row is the header
    headers = [str(h).strip() if h is not None else f"column_{i}" for i, h in enumerate(rows[0])]

    records: list[dict] = []
    for row in rows[1:]:
        # Skip completely empty rows
        if all(cell is None for cell in row):
            continue
        record = {}
        for i, cell in enumerate(row):
            key = headers[i] if i < len(headers) else f"column_{i}"
            record[key] = cell
        records.append(record)

    wb.close()

    return ExtractionResult(
        records=records,
        format="xlsx",
        row_count=len(records),
        dedup_hash=dedup_hash,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# PDF extraction
# ---------------------------------------------------------------------------


def extract_pdf(file_path: str) -> ExtractionResult:
    """Extract tables or text from a PDF file.

    Strategy:
    - Try pdfplumber to extract tables first
    - If no tables found, extract raw text and split by lines
    - Return raw text records when no structured tables exist
    """
    try:
        import pdfplumber
    except ImportError as exc:
        raise ImportError(
            "pdfplumber is required for PDF extraction. "
            "Install it with: pip install pdfplumber"
        ) from exc

    dedup_hash = _file_hash(file_path)
    warnings: list[str] = []
    records: list[dict] = []

    with pdfplumber.open(file_path) as pdf:
        if not pdf.pages:
            return ExtractionResult(
                records=[],
                format="pdf",
                row_count=0,
                dedup_hash=dedup_hash,
                warnings=["PDF has no pages"],
            )

        # Try table extraction across all pages
        all_tables: list[list[list[str | None]]] = []
        for page in pdf.pages:
            tables = page.extract_tables()
            if tables:
                all_tables.extend(tables)

        if all_tables:
            # Convert tables to dicts using first row as header
            for table in all_tables:
                if len(table) < 2:
                    continue
                headers = [str(h).strip() if h else f"column_{i}" for i, h in enumerate(table[0])]
                for row in table[1:]:
                    if all(cell is None or str(cell).strip() == "" for cell in row):
                        continue
                    record = {}
                    for i, cell in enumerate(row):
                        key = headers[i] if i < len(headers) else f"column_{i}"
                        record[key] = str(cell).strip() if cell else ""
                    records.append(record)
        else:
            # Fallback: extract text line by line
            warnings.append("No tables found in PDF; extracted raw text lines")
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text()
                if text:
                    for line in text.split("\n"):
                        stripped = line.strip()
                        if stripped:
                            records.append({"page": page_num, "text": stripped})

    return ExtractionResult(
        records=records,
        format="pdf",
        row_count=len(records),
        dedup_hash=dedup_hash,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Image extraction (stub)
# ---------------------------------------------------------------------------


def extract_image(file_path: str) -> ExtractionResult:
    """Stub for image extraction.

    Returns an empty result with a warning that OCR/Vision processing
    is required.  A future implementation will integrate with an LLM
    vision API or Tesseract OCR.
    """
    dedup_hash = _file_hash(file_path)
    return ExtractionResult(
        records=[],
        format="image",
        row_count=0,
        dedup_hash=dedup_hash,
        warnings=["Image extraction requires OCR/Vision processing (not yet implemented)"],
    )


# ---------------------------------------------------------------------------
# Auto-detect format and extract
# ---------------------------------------------------------------------------

_EXTENSION_MAP: dict[str, str] = {
    ".csv": "csv",
    ".xlsx": "xlsx",
    ".xls": "xlsx",
    ".pdf": "pdf",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".tiff": "image",
    ".tif": "image",
    ".bmp": "image",
    ".webp": "image",
}


def extract(file_path: str) -> ExtractionResult:
    """Auto-detect file format by extension and delegate to the right extractor.

    Supported formats: CSV, XLSX/XLS, PDF, images (stub).
    Raises ValueError for unsupported extensions.
    """
    ext = Path(file_path).suffix.lower()
    fmt = _EXTENSION_MAP.get(ext)

    if fmt is None:
        raise ValueError(
            f"Unsupported file format: '{ext}'. "
            f"Supported extensions: {sorted(_EXTENSION_MAP.keys())}"
        )

    if fmt == "csv":
        return extract_csv(file_path)
    if fmt == "xlsx":
        return extract_xlsx(file_path)
    if fmt == "pdf":
        return extract_pdf(file_path)
    if fmt == "image":
        return extract_image(file_path)

    # Should not reach here, but just in case
    raise ValueError(f"No extractor registered for format: {fmt}")
