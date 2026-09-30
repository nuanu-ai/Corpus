"""Document loader — Git integration via HTTP write queue.

Submits extracted QMD documents to the TS write queue via HTTP.
Converts extracted records to QMD format and commits them through
the company-db write queue API.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime

import httpx


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class LoadResult:
    """Outcome of a load operation."""

    success: bool
    intent_id: str | None = None
    commit_sha: str | None = None
    error: str | None = None
    records_loaded: int = 0


# ---------------------------------------------------------------------------
# Document type to path mapping
# ---------------------------------------------------------------------------

_DOCUMENT_TYPE_PATHS: dict[str, str] = {
    "bank_statement": "banking/transactions",
    "invoice": "revenue/invoices",
    "payroll_report": "people/payroll/runs",
    "pnl_report": "finance/statements/income-statement",
}


# ---------------------------------------------------------------------------
# DocumentLoader
# ---------------------------------------------------------------------------


class DocumentLoader:
    """Submits extracted records to the company-db write queue as QMD files.

    Parameters
    ----------
    queue_url:
        Base URL of the write queue HTTP server (e.g. ``http://localhost:3000``).
    queue_secret:
        Secret token for the ``X-Queue-Secret`` header.
    agent_id:
        Agent identifier used in the WriteIntent (default ``svc-extractor``).
    """

    def __init__(
        self,
        queue_url: str,
        queue_secret: str,
        agent_id: str = "svc-extractor",
    ):
        self.queue_url = queue_url.rstrip("/")
        self.queue_secret = queue_secret
        self.agent_id = agent_id

    # ── QMD content builder ───────────────────────────────────────────────

    def build_qmd_content(self, record: dict, document_type: str) -> str:
        """Build QMD file content from an extracted record.

        Produces a YAML front-matter block followed by a description line.
        """
        record_id = f"txn-{uuid.uuid4().hex[:12]}"
        date_value = record.get("date", "")
        amount = record.get("amount", 0)
        description = record.get("description", "")
        source_job = record.get("source_job", "")

        lines = [
            "---",
            f"type: {document_type}",
            f"id: {record_id}",
            f'date: "{date_value}"',
            f"amount: {amount}",
            f'description: "{description}"',
            'source: "extraction"',
            f'source_job: "{source_job}"',
            "---",
        ]

        # Build body text from record metadata
        body_parts: list[str] = []
        if document_type == "bank_statement":
            account = record.get("account", "unknown")
            period = record.get("period", "")
            body_parts.append(f"Extracted from {account} bank statement, {period}.")
        elif document_type == "invoice":
            vendor = record.get("vendor_name", "")
            body_parts.append(f"Extracted from invoice, vendor: {vendor}.")
        elif document_type == "payroll_report":
            period = record.get("period", "")
            body_parts.append(f"Extracted from payroll report, period: {period}.")
        elif document_type == "pnl_report":
            period = record.get("period", "")
            body_parts.append(f"Extracted from P&L report, period: {period}.")
        else:
            body_parts.append(f"Extracted {document_type} record.")

        lines.append(body_parts[0] if body_parts else "")

        return "\n".join(lines) + "\n"

    # ── File path builder ─────────────────────────────────────────────────

    def build_file_path(
        self, record: dict, document_type: str, index: int
    ) -> str:
        """Determine target file path based on document type.

        Path mappings:
        - bank_statement  -> banking/transactions/{YYYY-MM}/{account}-transactions.qmd
        - invoice         -> revenue/invoices/inv-{NNN}.qmd
        - payroll_report  -> people/payroll/runs/{date}-payroll.qmd
        - pnl_report      -> finance/statements/income-statement/{period}.qmd
        """
        base = _DOCUMENT_TYPE_PATHS.get(document_type)
        if base is None:
            # Fallback for unknown types
            return f"documents/imports/unknown/{document_type}/{index:04d}.qmd"

        if document_type == "bank_statement":
            date_str = record.get("date", "")
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                year_month = dt.strftime("%Y-%m")
            except (ValueError, TypeError):
                year_month = "unknown"
            account = record.get("account", "default")
            return f"{base}/{year_month}/{account}-txn-{index:04d}.qmd"

        if document_type == "invoice":
            invoice_number = record.get("invoice_number", index)
            return f"{base}/inv-{invoice_number:03}.qmd"

        if document_type == "payroll_report":
            date_str = record.get("date", "")
            if not date_str:
                date_str = f"run-{index:04d}"
            return f"{base}/{date_str}-payroll.qmd"

        if document_type == "pnl_report":
            period = record.get("period", f"period-{index:04d}")
            return f"{base}/{period}.qmd"

        return f"documents/imports/unknown/{document_type}/{index:04d}.qmd"

    # ── HTTP helpers ──────────────────────────────────────────────────────

    def _build_headers(self) -> dict[str, str]:
        """Return common HTTP headers for write queue requests."""
        return {
            "Content-Type": "application/json",
            "X-Queue-Secret": self.queue_secret,
        }

    async def _post_intent(
        self,
        client: httpx.AsyncClient,
        intent: dict,
    ) -> dict:
        """POST a write intent to the queue and return the parsed response.

        Raises ``RuntimeError`` on non-200 responses.
        """
        url = f"{self.queue_url}/write"
        resp = await client.post(
            url,
            json=intent,
            headers=self._build_headers(),
        )

        if resp.status_code != 200:
            body = resp.text
            raise RuntimeError(
                f"Write queue returned {resp.status_code}: {body}"
            )

        return resp.json()

    # ── load_records ──────────────────────────────────────────────────────

    async def load_records(
        self,
        records: list[dict],
        document_type: str,
        job_id: str,
    ) -> LoadResult:
        """Submit records to write queue as a single commit.

        Steps:
        1. Convert records to QMD files (path + content pairs).
        2. Build a WriteIntent with ``type: "commit"``.
        3. POST to ``{queue_url}/write`` with secret header.
        4. Return LoadResult.
        """
        if not records:
            return LoadResult(
                success=True,
                records_loaded=0,
            )

        # 1. Convert records to file changes
        files: list[dict[str, str]] = []
        for i, record in enumerate(records):
            path = self.build_file_path(record, document_type, i)
            content = self.build_qmd_content(record, document_type)
            files.append({"path": path, "content": content})

        # 2. Build WriteIntent
        intent: dict = {
            "agentId": self.agent_id,
            "agentToken": self.queue_secret,
            "domain": _domain_for_type(document_type),
            "operation": {
                "type": "commit",
                "files": files,
                "commitMessage": f"extract({document_type}): load {len(records)} records from job {job_id}",
            },
            "metadata": {
                "jobId": job_id,
                "documentType": document_type,
                "recordCount": len(records),
            },
        }

        # 3. POST to write queue
        try:
            async with httpx.AsyncClient() as client:
                result = await self._post_intent(client, intent)
        except Exception as exc:
            return LoadResult(
                success=False,
                error=str(exc),
                records_loaded=0,
            )

        # 4. Return LoadResult
        success = result.get("success", False)
        return LoadResult(
            success=success,
            intent_id=result.get("intentId"),
            commit_sha=result.get("commitSha"),
            error=result.get("error", {}).get("message") if not success else None,
            records_loaded=len(records) if success else 0,
        )

    # ── load_on_branch ────────────────────────────────────────────────────

    async def load_on_branch(
        self,
        records: list[dict],
        document_type: str,
        job_id: str,
    ) -> LoadResult:
        """Create extraction branch, commit records, merge to main.

        Steps:
        1. Create branch via ``type: "create_branch"``.
        2. Commit records to branch via ``type: "commit_to_branch"``.
        3. Merge branch to main via ``type: "merge_branch"``.
        """
        if not records:
            return LoadResult(success=True, records_loaded=0)

        branch_name = f"extract/{job_id}"
        domain = _domain_for_type(document_type)

        try:
            async with httpx.AsyncClient() as client:
                # Step 1: Create branch
                create_intent: dict = {
                    "agentId": self.agent_id,
                    "agentToken": self.queue_secret,
                    "domain": domain,
                    "operation": {
                        "type": "create_branch",
                        "branchName": branch_name,
                    },
                }
                await self._post_intent(client, create_intent)

                # Step 2: Commit records to branch
                files: list[dict[str, str]] = []
                for i, record in enumerate(records):
                    path = self.build_file_path(record, document_type, i)
                    content = self.build_qmd_content(record, document_type)
                    files.append({"path": path, "content": content})

                commit_intent: dict = {
                    "agentId": self.agent_id,
                    "agentToken": self.queue_secret,
                    "domain": domain,
                    "operation": {
                        "type": "commit_to_branch",
                        "branchName": branch_name,
                        "files": files,
                        "commitMessage": (
                            f"extract({document_type}): load {len(records)} "
                            f"records from job {job_id}"
                        ),
                    },
                    "metadata": {
                        "jobId": job_id,
                        "documentType": document_type,
                        "recordCount": len(records),
                    },
                }
                await self._post_intent(client, commit_intent)

                # Step 3: Merge branch to main
                merge_intent: dict = {
                    "agentId": self.agent_id,
                    "agentToken": self.queue_secret,
                    "domain": domain,
                    "operation": {
                        "type": "merge_branch",
                        "sourceBranch": branch_name,
                        "targetBranch": "main",
                        "commitMessage": (
                            f"merge extract/{job_id}: "
                            f"{len(records)} {document_type} records"
                        ),
                        "conflictPolicy": "ours",
                    },
                }
                merge_result = await self._post_intent(client, merge_intent)

        except Exception as exc:
            return LoadResult(
                success=False,
                error=str(exc),
                records_loaded=0,
            )

        success = merge_result.get("success", False)
        return LoadResult(
            success=success,
            intent_id=merge_result.get("intentId"),
            commit_sha=merge_result.get("commitSha"),
            error=(
                merge_result.get("error", {}).get("message")
                if not success
                else None
            ),
            records_loaded=len(records) if success else 0,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _domain_for_type(document_type: str) -> str:
    """Map a document type to a company-db domain name."""
    mapping = {
        "bank_statement": "banking",
        "invoice": "revenue",
        "payroll_report": "people",
        "pnl_report": "finance",
    }
    return mapping.get(document_type, "documents")
