"""Tests for document loader — Git integration via HTTP write queue.

Uses unittest.mock to mock httpx HTTP calls.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from extraction.loader import DocumentLoader, LoadResult, _domain_for_type


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def loader() -> DocumentLoader:
    """Create a DocumentLoader with test configuration."""
    return DocumentLoader(
        queue_url="http://localhost:3000",
        queue_secret="test-secret-123",
        agent_id="svc-extractor",
    )


@pytest.fixture
def bank_records() -> list[dict]:
    """Sample bank statement records."""
    return [
        {
            "date": "2024-01-15",
            "amount": -150000,
            "description": "Transfer to supplier",
            "account": "bca-main",
            "source_job": "job-001",
            "period": "January 2024",
        },
        {
            "date": "2024-01-16",
            "amount": 500000,
            "description": "Client payment received",
            "account": "bca-main",
            "source_job": "job-001",
            "period": "January 2024",
        },
    ]


@pytest.fixture
def invoice_records() -> list[dict]:
    """Sample invoice records."""
    return [
        {
            "date": "2024-02-01",
            "amount": 1200000,
            "description": "Consulting services",
            "invoice_number": 42,
            "vendor_name": "Example Vendor Ltd",
            "source_job": "job-002",
        },
    ]


@pytest.fixture
def payroll_records() -> list[dict]:
    """Sample payroll records."""
    return [
        {
            "date": "2024-03-01",
            "amount": -8000000,
            "description": "March payroll run",
            "period": "2024-03",
            "source_job": "job-003",
        },
    ]


# ---------------------------------------------------------------------------
# 1. build_qmd_content generates valid QMD
# ---------------------------------------------------------------------------


class TestBuildQmdContent:
    def test_bank_statement_qmd(self, loader: DocumentLoader):
        record = {
            "date": "2024-01-15",
            "amount": -150000,
            "description": "Transfer to supplier",
            "source_job": "job-001",
            "account": "bca-main",
            "period": "January 2024",
        }
        content = loader.build_qmd_content(record, "bank_statement")

        assert content.startswith("---\n")
        assert "type: bank_statement" in content
        assert 'date: "2024-01-15"' in content
        assert "amount: -150000" in content
        assert 'description: "Transfer to supplier"' in content
        assert 'source: "extraction"' in content
        assert 'source_job: "job-001"' in content
        assert "id: txn-" in content
        assert "Extracted from bca-main bank statement, January 2024." in content

    def test_invoice_qmd(self, loader: DocumentLoader):
        record = {
            "date": "2024-02-01",
            "amount": 1200000,
            "description": "Consulting",
            "source_job": "job-002",
            "vendor_name": "Example Vendor Ltd",
        }
        content = loader.build_qmd_content(record, "invoice")

        assert "type: invoice" in content
        assert "Extracted from invoice, vendor: Example Vendor Ltd." in content

    def test_payroll_qmd(self, loader: DocumentLoader):
        record = {
            "date": "2024-03-01",
            "amount": -8000000,
            "description": "Payroll",
            "source_job": "job-003",
            "period": "2024-03",
        }
        content = loader.build_qmd_content(record, "payroll_report")

        assert "type: payroll_report" in content
        assert "Extracted from payroll report, period: 2024-03." in content

    def test_pnl_qmd(self, loader: DocumentLoader):
        record = {
            "date": "2024-01-31",
            "amount": 5000000,
            "description": "Monthly P&L",
            "source_job": "job-004",
            "period": "2024-01",
        }
        content = loader.build_qmd_content(record, "pnl_report")

        assert "type: pnl_report" in content
        assert "Extracted from P&L report, period: 2024-01." in content

    def test_unknown_type_qmd(self, loader: DocumentLoader):
        record = {
            "date": "2024-01-01",
            "amount": 100,
            "description": "Test",
            "source_job": "job-x",
        }
        content = loader.build_qmd_content(record, "custom_doc")

        assert "type: custom_doc" in content
        assert "Extracted custom_doc record." in content

    def test_qmd_has_yaml_frontmatter(self, loader: DocumentLoader):
        """QMD content should have proper YAML front-matter delimiters."""
        record = {"date": "2024-01-01", "amount": 0, "description": "Test"}
        content = loader.build_qmd_content(record, "bank_statement")

        lines = content.strip().split("\n")
        assert lines[0] == "---"
        # Find closing delimiter
        closing_idx = None
        for i in range(1, len(lines)):
            if lines[i] == "---":
                closing_idx = i
                break
        assert closing_idx is not None, "Missing closing --- delimiter"
        # Body text should follow the closing delimiter
        assert len(lines) > closing_idx


# ---------------------------------------------------------------------------
# 2. build_file_path maps types correctly
# ---------------------------------------------------------------------------


class TestBuildFilePath:
    def test_bank_statement_path(self, loader: DocumentLoader):
        record = {"date": "2024-01-15", "account": "bca-main"}
        path = loader.build_file_path(record, "bank_statement", 0)
        assert path == "banking/transactions/2024-01/bca-main-txn-0000.qmd"

    def test_bank_statement_path_different_month(self, loader: DocumentLoader):
        record = {"date": "2024-12-25", "account": "mercury-usd"}
        path = loader.build_file_path(record, "bank_statement", 0)
        assert path == "banking/transactions/2024-12/mercury-usd-txn-0000.qmd"

    def test_bank_statement_path_invalid_date(self, loader: DocumentLoader):
        record = {"date": "invalid", "account": "bca"}
        path = loader.build_file_path(record, "bank_statement", 0)
        assert path == "banking/transactions/unknown/bca-txn-0000.qmd"

    def test_bank_statement_path_missing_date(self, loader: DocumentLoader):
        record = {"account": "bca"}
        path = loader.build_file_path(record, "bank_statement", 0)
        assert path == "banking/transactions/unknown/bca-txn-0000.qmd"

    def test_bank_statement_path_default_account(self, loader: DocumentLoader):
        record = {"date": "2024-06-01"}
        path = loader.build_file_path(record, "bank_statement", 0)
        assert path == "banking/transactions/2024-06/default-txn-0000.qmd"

    def test_bank_statement_paths_unique_with_index(self, loader: DocumentLoader):
        """Multiple records with same account/period produce unique paths."""
        record = {"date": "2024-01-15", "account": "bca-main"}
        path0 = loader.build_file_path(record, "bank_statement", 0)
        path1 = loader.build_file_path(record, "bank_statement", 1)
        path2 = loader.build_file_path(record, "bank_statement", 2)
        assert path0 != path1
        assert path1 != path2
        assert path0 == "banking/transactions/2024-01/bca-main-txn-0000.qmd"
        assert path1 == "banking/transactions/2024-01/bca-main-txn-0001.qmd"
        assert path2 == "banking/transactions/2024-01/bca-main-txn-0002.qmd"

    def test_invoice_path(self, loader: DocumentLoader):
        record = {"invoice_number": 42}
        path = loader.build_file_path(record, "invoice", 0)
        assert path == "revenue/invoices/inv-042.qmd"

    def test_invoice_path_with_index_fallback(self, loader: DocumentLoader):
        record = {}
        path = loader.build_file_path(record, "invoice", 7)
        assert path == "revenue/invoices/inv-007.qmd"

    def test_payroll_path(self, loader: DocumentLoader):
        record = {"date": "2024-03-01"}
        path = loader.build_file_path(record, "payroll_report", 0)
        assert path == "people/payroll/runs/2024-03-01-payroll.qmd"

    def test_payroll_path_no_date(self, loader: DocumentLoader):
        record = {}
        path = loader.build_file_path(record, "payroll_report", 3)
        assert path == "people/payroll/runs/run-0003-payroll.qmd"

    def test_pnl_path(self, loader: DocumentLoader):
        record = {"period": "2024-Q1"}
        path = loader.build_file_path(record, "pnl_report", 0)
        assert path == "finance/statements/income-statement/2024-Q1.qmd"

    def test_pnl_path_no_period(self, loader: DocumentLoader):
        record = {}
        path = loader.build_file_path(record, "pnl_report", 2)
        assert path == "finance/statements/income-statement/period-0002.qmd"

    def test_unknown_type_path(self, loader: DocumentLoader):
        record = {}
        path = loader.build_file_path(record, "unknown_doc", 5)
        assert path == "documents/imports/unknown/unknown_doc/0005.qmd"


# ---------------------------------------------------------------------------
# 3. load_records sends correct HTTP request (mock)
# ---------------------------------------------------------------------------


class TestLoadRecords:
    @pytest.mark.asyncio
    async def test_load_records_success(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "intentId": "intent-abc",
            "commitSha": "sha-123456",
        }

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_records(
                bank_records, "bank_statement", "job-001"
            )

        assert isinstance(result, LoadResult)
        assert result.success is True
        assert result.intent_id == "intent-abc"
        assert result.commit_sha == "sha-123456"
        assert result.records_loaded == 2
        assert result.error is None

        # Verify the HTTP call
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args.args[0] == "http://localhost:3000/write"

        # Verify headers
        headers = call_args.kwargs["headers"]
        assert headers["X-Queue-Secret"] == "test-secret-123"
        assert headers["Content-Type"] == "application/json"

        # Verify intent body
        body = call_args.kwargs["json"]
        assert body["agentId"] == "svc-extractor"
        assert body["agentToken"] == "test-secret-123"
        assert body["domain"] == "banking"
        assert body["operation"]["type"] == "commit"
        assert len(body["operation"]["files"]) == 2
        assert "commitMessage" in body["operation"]
        assert "job-001" in body["operation"]["commitMessage"]

    @pytest.mark.asyncio
    async def test_load_records_empty(self, loader: DocumentLoader):
        result = await loader.load_records([], "bank_statement", "job-empty")
        assert result.success is True
        assert result.records_loaded == 0

    @pytest.mark.asyncio
    async def test_load_records_file_paths(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        """Verify that file paths in the commit are correctly built."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "intentId": "intent-x",
            "commitSha": "sha-x",
        }

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            await loader.load_records(bank_records, "bank_statement", "job-001")

        body = mock_client.post.call_args.kwargs["json"]
        files = body["operation"]["files"]

        # Both records are from 2024-01, account bca-main — index makes them unique
        assert files[0]["path"] == "banking/transactions/2024-01/bca-main-txn-0000.qmd"
        assert files[1]["path"] == "banking/transactions/2024-01/bca-main-txn-0001.qmd"

        # Content should be valid QMD
        for f in files:
            assert f["content"].startswith("---\n")
            assert "type: bank_statement" in f["content"]


# ---------------------------------------------------------------------------
# 4. load_on_branch sends 3 requests in order (mock)
# ---------------------------------------------------------------------------


class TestLoadOnBranch:
    @pytest.mark.asyncio
    async def test_load_on_branch_sends_three_requests(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "intentId": "intent-merge",
            "commitSha": "sha-merged",
        }

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_on_branch(
                bank_records, "bank_statement", "job-branch-001"
            )

        assert result.success is True
        assert result.intent_id == "intent-merge"
        assert result.commit_sha == "sha-merged"
        assert result.records_loaded == 2

        # Verify 3 POST requests were made
        assert mock_client.post.call_count == 3

        # Request 1: create_branch
        call1 = mock_client.post.call_args_list[0]
        body1 = call1.kwargs["json"]
        assert body1["operation"]["type"] == "create_branch"
        assert body1["operation"]["branchName"] == "extract/job-branch-001"

        # Request 2: commit_to_branch
        call2 = mock_client.post.call_args_list[1]
        body2 = call2.kwargs["json"]
        assert body2["operation"]["type"] == "commit_to_branch"
        assert body2["operation"]["branchName"] == "extract/job-branch-001"
        assert len(body2["operation"]["files"]) == 2

        # Request 3: merge_branch
        call3 = mock_client.post.call_args_list[2]
        body3 = call3.kwargs["json"]
        assert body3["operation"]["type"] == "merge_branch"
        assert body3["operation"]["sourceBranch"] == "extract/job-branch-001"
        assert body3["operation"]["targetBranch"] == "main"
        assert body3["operation"]["conflictPolicy"] == "ours"

    @pytest.mark.asyncio
    async def test_load_on_branch_empty_records(self, loader: DocumentLoader):
        result = await loader.load_on_branch([], "bank_statement", "job-empty")
        assert result.success is True
        assert result.records_loaded == 0

    @pytest.mark.asyncio
    async def test_load_on_branch_all_requests_use_correct_url(
        self, loader: DocumentLoader, invoice_records: list[dict]
    ):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "intentId": "i-1",
            "commitSha": "sha-1",
        }

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            await loader.load_on_branch(
                invoice_records, "invoice", "job-inv-001"
            )

        # All requests should go to /write
        for call in mock_client.post.call_args_list:
            assert call.args[0] == "http://localhost:3000/write"

    @pytest.mark.asyncio
    async def test_load_on_branch_domain_mapping(
        self, loader: DocumentLoader, invoice_records: list[dict]
    ):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            await loader.load_on_branch(
                invoice_records, "invoice", "job-inv-002"
            )

        # All intents should target the "revenue" domain
        for call in mock_client.post.call_args_list:
            body = call.kwargs["json"]
            assert body["domain"] == "revenue"


# ---------------------------------------------------------------------------
# 5. HTTP error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    @pytest.mark.asyncio
    async def test_load_records_http_401(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.text = '{"error": "Unauthorized"}'

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_records(
                bank_records, "bank_statement", "job-fail"
            )

        assert result.success is False
        assert result.error is not None
        assert "401" in result.error
        assert result.records_loaded == 0

    @pytest.mark.asyncio
    async def test_load_records_http_500(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = '{"error": "Internal server error"}'

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_records(
                bank_records, "bank_statement", "job-500"
            )

        assert result.success is False
        assert "500" in result.error

    @pytest.mark.asyncio
    async def test_load_records_connection_error(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.ConnectError("Connection refused")
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_records(
                bank_records, "bank_statement", "job-conn"
            )

        assert result.success is False
        assert result.error is not None
        assert result.records_loaded == 0

    @pytest.mark.asyncio
    async def test_load_on_branch_fails_on_create_branch(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        """If create_branch fails, the whole operation should fail."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal error"

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_on_branch(
                bank_records, "bank_statement", "job-fail-branch"
            )

        assert result.success is False
        assert result.error is not None
        # Should only have attempted the first request before failing
        assert mock_client.post.call_count == 1

    @pytest.mark.asyncio
    async def test_load_on_branch_fails_on_commit(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        """If commit_to_branch fails (2nd request), the whole operation fails."""
        success_response = MagicMock()
        success_response.status_code = 200
        success_response.json.return_value = {"success": True}

        fail_response = MagicMock()
        fail_response.status_code = 500
        fail_response.text = "Commit failed"

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.side_effect = [success_response, fail_response]
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_on_branch(
                bank_records, "bank_statement", "job-fail-commit"
            )

        assert result.success is False
        assert result.error is not None
        assert mock_client.post.call_count == 2

    @pytest.mark.asyncio
    async def test_load_records_queue_reports_failure(
        self, loader: DocumentLoader, bank_records: list[dict]
    ):
        """Write queue returns 200 but success=false (e.g. permission denied)."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": False,
            "intentId": "intent-denied",
            "error": {
                "code": "permission",
                "message": "Agent not allowed to write to banking/",
            },
        }

        with patch("extraction.loader.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await loader.load_records(
                bank_records, "bank_statement", "job-denied"
            )

        assert result.success is False
        assert result.intent_id == "intent-denied"
        assert result.error is not None
        assert "permission" in result.error.lower() or "not allowed" in result.error.lower()
        assert result.records_loaded == 0


# ---------------------------------------------------------------------------
# Domain mapping helper
# ---------------------------------------------------------------------------


class TestDomainMapping:
    def test_bank_statement_domain(self):
        assert _domain_for_type("bank_statement") == "banking"

    def test_invoice_domain(self):
        assert _domain_for_type("invoice") == "revenue"

    def test_payroll_domain(self):
        assert _domain_for_type("payroll_report") == "people"

    def test_pnl_domain(self):
        assert _domain_for_type("pnl_report") == "finance"

    def test_unknown_domain(self):
        assert _domain_for_type("custom_thing") == "documents"


# ---------------------------------------------------------------------------
# Constructor / configuration
# ---------------------------------------------------------------------------


class TestLoaderConfig:
    def test_trailing_slash_stripped(self):
        loader = DocumentLoader("http://localhost:3000/", "secret", "agent")
        assert loader.queue_url == "http://localhost:3000"

    def test_default_agent_id(self):
        loader = DocumentLoader("http://localhost:3000", "secret")
        assert loader.agent_id == "svc-extractor"

    def test_custom_agent_id(self):
        loader = DocumentLoader("http://localhost:3000", "secret", "my-agent")
        assert loader.agent_id == "my-agent"
