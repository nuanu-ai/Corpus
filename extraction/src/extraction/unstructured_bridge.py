"""Bridge script for optional Unstructured extraction.

Input: a local file path and file type.
Output: JSON to stdout:
  {"ok": true, "backend": "unstructured"|"pdfplumber", "text": "...", "metadata": {...}}
  {"ok": false, "error": "..."}

This script is intentionally standalone so the Node parser can call it without
importing the Python package directly.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def _extract_with_unstructured(file_path: str) -> dict | None:
    try:
        from unstructured.partition.auto import partition  # type: ignore
    except Exception:
        return None

    try:
        elements = partition(filename=file_path)
        chunks: list[str] = []
        for el in elements:
            text = getattr(el, "text", None)
            if isinstance(text, str) and text.strip():
                chunks.append(text.strip())
        return {
            "ok": True,
            "backend": "unstructured",
            "text": "\n".join(chunks),
            "metadata": {
                "element_count": len(elements),
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"unstructured extraction failed: {exc}",
        }


def _extract_with_pdfplumber(file_path: str) -> dict | None:
    try:
        import pdfplumber  # type: ignore
    except Exception:
        return None

    try:
        lines: list[str] = []
        page_count = 0
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                text = page.extract_text() or ""
                if text.strip():
                    lines.append(text.strip())

        return {
            "ok": True,
            "backend": "pdfplumber",
            "text": "\n\n".join(lines),
            "metadata": {
                "page_count": page_count,
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"pdfplumber extraction failed: {exc}",
        }


def run(file_path: str, file_type: str) -> dict:
    if not Path(file_path).exists():
        return {"ok": False, "error": f"Input file not found: {file_path}"}

    # Prefer Unstructured when available for both PDF and image documents.
    unstructured = _extract_with_unstructured(file_path)
    if unstructured is not None:
        return unstructured

    # Fallback for PDF only.
    if file_type == "pdf":
        pdf_result = _extract_with_pdfplumber(file_path)
        if pdf_result is not None:
            return pdf_result

    return {
        "ok": False,
        "error": "No supported extraction backend available (install unstructured[pdf] or pdfplumber).",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to file")
    parser.add_argument("--file-type", required=True, choices=["pdf", "image"])
    args = parser.parse_args()

    result = run(args.input, args.file_type)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
