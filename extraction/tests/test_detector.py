"""Tests for document type detector."""

from __future__ import annotations

from pathlib import Path

import pytest

from extraction.detector import DetectionResult, detect_document


# ---------------------------------------------------------------------------
# 1. BCA bank statement detection (filename match)
# ---------------------------------------------------------------------------


class TestBCABankStatement:
    def test_rekening_koran_xlsx(self):
        result = detect_document("Rekening_Koran_Jan2025.xlsx")
        assert result.document_type == "bank_statement"
        assert result.schema_id == "bank_statement_bca"
        assert result.confidence == 0.9
        assert result.metadata["detected_bank"] == "BCA"

    def test_bca_statement_pdf(self):
        result = detect_document("bca_statement_2025.pdf")
        assert result.document_type == "bank_statement"
        assert result.schema_id == "bank_statement_bca"
        assert result.confidence == 0.9
        assert result.metadata["detected_bank"] == "BCA"

    def test_mandiri_statement(self):
        result = detect_document("mandiri_statement_feb.xlsx")
        assert result.document_type == "bank_statement"
        assert result.schema_id == "bank_statement_mandiri"
        assert result.confidence == 0.9
        assert result.metadata["detected_bank"] == "Mandiri"


# ---------------------------------------------------------------------------
# 2. Mercury CSV detection
# ---------------------------------------------------------------------------


class TestMercuryCSV:
    def test_mercury_csv_full_match(self):
        result = detect_document("mercury_transactions_2025.csv")
        assert result.document_type == "bank_statement"
        assert result.schema_id == "bank_statement_mercury"
        assert result.confidence == 0.9
        assert result.metadata["detected_bank"] == "Mercury"

    def test_mercury_without_csv_extension(self):
        """Mercury without .csv should get lower confidence."""
        result = detect_document("mercury_export.xlsx")
        assert result.document_type == "bank_statement"
        assert result.schema_id == "bank_statement_mercury"
        assert result.confidence == 0.7

    def test_mercury_csv_with_content_boost(self):
        """Mercury CSV with matching headers gets a content boost."""
        content = b"Date,Amount,Status,Bank Description,Notes\n2025-01-01,100.00,Sent,Wire,Test\n"
        result = detect_document("mercury_2025.csv", content=content)
        assert result.document_type == "bank_statement"
        assert result.schema_id == "bank_statement_mercury"
        assert result.confidence >= 1.0  # 0.9 + 0.2 capped at 1.0


# ---------------------------------------------------------------------------
# 3. Generic invoice detection
# ---------------------------------------------------------------------------


class TestInvoice:
    def test_invoice_pdf(self):
        result = detect_document("invoice_001.pdf")
        assert result.document_type == "invoice"
        assert result.schema_id == "invoice_generic"
        assert result.confidence == 0.9

    def test_invoice_xlsx(self):
        result = detect_document("monthly_invoice_march.xlsx")
        assert result.document_type == "invoice"
        assert result.schema_id == "invoice_generic"
        assert result.confidence == 0.9

    def test_faktur_pajak(self):
        result = detect_document("faktur_pajak_0001.pdf")
        assert result.document_type == "tax_invoice"
        assert result.schema_id == "tax_invoice_id"
        assert result.metadata["detected_country"] == "ID"


# ---------------------------------------------------------------------------
# 4. Unknown document (low confidence)
# ---------------------------------------------------------------------------


class TestUnknown:
    def test_completely_unknown(self):
        result = detect_document("random_file.xyz")
        assert result.document_type == "unknown"
        assert result.schema_id is None
        assert result.confidence == 0.0

    def test_unknown_no_extension(self):
        result = detect_document("mystery_document")
        assert result.document_type == "unknown"
        assert result.confidence == 0.0


# ---------------------------------------------------------------------------
# 5. PDF extension detection
# ---------------------------------------------------------------------------


class TestExtensionOnly:
    def test_pdf_extension_only(self):
        """A PDF with no filename pattern match gets extension-only confidence."""
        result = detect_document("some_random_doc.pdf")
        assert result.document_type == "document"
        assert result.schema_id is None
        assert result.confidence == 0.3
        assert result.metadata["extension"] == ".pdf"

    def test_csv_extension_only(self):
        result = detect_document("data_export.csv")
        assert result.document_type == "spreadsheet"
        assert result.confidence == 0.3

    def test_image_extension(self):
        result = detect_document("scan.png")
        assert result.document_type == "image"
        assert result.confidence == 0.3

    def test_jpg_extension(self):
        result = detect_document("receipt.jpg")
        assert result.document_type == "image"
        assert result.confidence == 0.3


# ---------------------------------------------------------------------------
# 6. Content-based boost (CSV with known headers)
# ---------------------------------------------------------------------------


class TestContentBasedBoost:
    def test_csv_with_bank_statement_headers(self):
        """CSV with date/description/amount headers detected as bank_statement."""
        content = b"Date,Description,Amount\n2025-01-15,Coffee,-5.00\n"
        result = detect_document("transactions.csv", content=content)
        assert result.document_type == "bank_statement"
        assert result.confidence == 0.5  # 0.3 (ext) + 0.2 (content boost)

    def test_csv_with_payroll_headers(self):
        content = b"Employee,Gross,Net,Deductions\nJohn,5000,4200,800\n"
        result = detect_document("monthly_data.csv", content=content)
        assert result.document_type == "payroll_report"
        assert result.schema_id == "payroll_report"
        assert result.confidence == 0.5

    def test_csv_no_matching_headers(self):
        """CSV with unrecognized headers — extension-only confidence."""
        content = b"foo,bar,baz\n1,2,3\n"
        result = detect_document("random.csv", content=content)
        assert result.document_type == "spreadsheet"
        assert result.confidence == 0.3

    def test_filename_match_plus_content_boost(self):
        """Filename match + content headers = filename confidence + boost."""
        content = b"Date,Description,Amount\n2025-01-15,Transfer,1000\n"
        result = detect_document("bca_statement_jan.csv", content=content)
        assert result.document_type == "bank_statement"
        assert result.schema_id == "bank_statement_bca"
        assert result.confidence == 1.0  # 0.9 + 0.2 capped at 1.0

    def test_content_ignored_for_non_csv(self):
        """Content-based detection only runs for CSV files currently."""
        content = b"Date,Description,Amount\n2025-01-15,Coffee,-5.00\n"
        result = detect_document("data.xlsx", content=content)
        # .xlsx with no filename match → extension only
        assert result.document_type == "spreadsheet"
        assert result.confidence == 0.3


# ---------------------------------------------------------------------------
# Additional edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_pnl_report(self):
        result = detect_document("pnl_2025_q1.xlsx")
        assert result.document_type == "pnl_report"
        assert result.schema_id == "pnl_report"
        assert result.confidence == 0.9

    def test_profit_loss_report(self):
        result = detect_document("profit_loss_statement_annual.pdf")
        assert result.document_type == "pnl_report"
        assert result.confidence == 0.9

    def test_income_statement(self):
        result = detect_document("income_statement_2024.csv")
        assert result.document_type == "pnl_report"
        assert result.confidence == 0.9

    def test_balance_sheet(self):
        result = detect_document("balance_sheet_dec2024.xlsx")
        assert result.document_type == "balance_sheet"
        assert result.schema_id == "balance_sheet"
        assert result.confidence == 0.9

    def test_payroll_report(self):
        result = detect_document("payroll_march_2025.csv")
        assert result.document_type == "payroll_report"
        assert result.schema_id == "payroll_report"
        assert result.confidence == 0.9

    def test_result_is_dataclass(self):
        result = detect_document("test.pdf")
        assert isinstance(result, DetectionResult)
        assert hasattr(result, "document_type")
        assert hasattr(result, "schema_id")
        assert hasattr(result, "confidence")
        assert hasattr(result, "metadata")
