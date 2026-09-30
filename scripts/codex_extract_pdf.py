#!/usr/bin/env python3

import argparse
import json
import sys
from pathlib import Path


DEFAULT_RENDER_MAX_PAGES = 16
DEFAULT_RENDER_SPARSE_THRESHOLD = 80
DEFAULT_RENDER_DPI = 144


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="codex_extract_pdf.py",
        description="Extract PDF page text and optionally render sparse pages for visual analysis.",
    )
    parser.add_argument("pdf_path")
    parser.add_argument("--image-dir", default=None)
    parser.add_argument("--image-max-pages", type=int, default=DEFAULT_RENDER_MAX_PAGES)
    parser.add_argument(
        "--image-sparse-threshold",
        type=int,
        default=DEFAULT_RENDER_SPARSE_THRESHOLD,
    )
    parser.add_argument("--image-dpi", type=int, default=DEFAULT_RENDER_DPI)
    return parser.parse_args(argv)


def _render_sparse_pages(
    pdf_path: Path,
    pages: list[dict],
    image_dir: Path,
    max_pages: int,
    sparse_threshold: int,
    dpi: int,
) -> dict:
    render_state = {
        "requested": True,
        "rendered": 0,
        "skipped": 0,
        "max_pages": max(0, max_pages),
        "sparse_threshold": max(0, sparse_threshold),
        "dpi": max(72, dpi),
    }
    if max_pages <= 0:
        render_state["skipped"] = len(pages)
        return render_state

    try:
        import pypdfium2 as pdfium
    except Exception as exc:  # pragma: no cover
        render_state["error"] = f"pypdfium2 import failed: {exc}"
        render_state["skipped"] = len(pages)
        return render_state

    sparse_pages = [
        page for page in pages
        if int(page.get("char_count") or 0) < sparse_threshold
    ]
    selected_pages = sparse_pages[:max_pages]
    render_state["skipped"] = max(0, len(sparse_pages) - len(selected_pages))
    if not selected_pages:
        return render_state

    image_dir.mkdir(parents=True, exist_ok=True)
    scale = max(72, dpi) / 72

    try:
        pdf = pdfium.PdfDocument(str(pdf_path))
        try:
            for page_info in selected_pages:
                page_number = int(page_info["page_number"])
                page = pdf[page_number - 1]
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil()
                image_path = image_dir / f"page-{page_number:03d}.jpg"
                image.save(image_path, format="JPEG", quality=88, optimize=True)
                page_info["image_path"] = str(image_path)
                page_info["image_width"] = image.width
                page_info["image_height"] = image.height
                page_info["image_reason"] = "sparse_machine_text"
                render_state["rendered"] += 1
        finally:
            close = getattr(pdf, "close", None)
            if callable(close):
                close()
    except Exception as exc:
        render_state["error"] = str(exc)

    return render_state


def main() -> int:
    args = _parse_args(sys.argv[1:])
    pdf_path = Path(args.pdf_path)
    if not pdf_path.exists():
        print(json.dumps({"ok": False, "error": f"file not found: {pdf_path}"}))
        return 1

    try:
        import pdfplumber
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "error": f"pdfplumber import failed: {exc}"}))
        return 1

    pages: list[dict] = []
    try:
        with pdfplumber.open(str(pdf_path)) as pdf:
            for idx, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                pages.append(
                    {
                        "page_number": idx,
                        "text": text,
                        "char_count": len(text),
                    }
                )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    render = None
    if args.image_dir:
        render = _render_sparse_pages(
            pdf_path,
            pages,
            Path(args.image_dir),
            args.image_max_pages,
            args.image_sparse_threshold,
            args.image_dpi,
        )

    payload = {"ok": True, "pages": pages}
    if render is not None:
        payload["render"] = render

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
