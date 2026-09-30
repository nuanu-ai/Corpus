import type { CodexArtifactManifest } from "./types";

function quote(value: unknown): string {
  return JSON.stringify(value ?? "unknown");
}

interface BuildCodexAuditPromptInput {
  manifest: CodexArtifactManifest;
  companyDbArtifactPaths: string[];
  domainSummaryPaths: string[];
}

function listPaths(paths: string[]): string {
  if (paths.length === 0) return "- none";
  return paths.map((path) => `- ${quote(path)}`).join("\n");
}

export function buildCodexAuditPrompt(input: BuildCodexAuditPromptInput): string {
  const { manifest, companyDbArtifactPaths, domainSummaryPaths } = input;

  return [
    "You are a senior financial controls + data-quality auditor.",
    "",
    "You are auditing one already-processed document.",
    "Your job is to verify whether the current stored Company-DB outputs are faithful to the source document and whether downstream retrieval looks safe.",
    "",
    "You must inspect all of these:",
    "1. the original uploaded file",
    "2. artifacts/manifest.json",
    "3. preview markdown files and raw extracted units",
    "4. audit/current-document.json",
    "5. current-company-db/**/*.qmd",
    "",
    "Important constraints:",
    "- Do not invent facts.",
    "- Use only evidence in the source file, generated artifacts, or current Company-DB files.",
    "- Be strict about period, scope, currency, sign convention, and missing metrics.",
    "- If current outputs are ambiguous, prefer warning/fail over false confidence.",
    "- Return JSON only.",
    "",
    "What to audit:",
    "- source_artifact_coverage: do generated artifacts cover the source document sufficiently for downstream use?",
    "- current_output_presence: are there current Company-DB artifacts for this document and are they internally coherent?",
    "- period_scope_consistency: do stored periods and entity scope match the source workbook/document?",
    "- finance_metric_completeness: for finance-like documents, are key metrics present and non-placeholder?",
    "- drilldown_surface: do surfaced summaries and promoted outputs look retrievable and not obviously stale or misleading?",
    "",
    "How to judge statuses:",
    "- pass: no material concern",
    "- warning: usable but risky / incomplete / ambiguous",
    "- fail: materially wrong, stale, misleading, or missing for the intended use",
    "- not_applicable: genuinely not relevant for this document",
    "",
    "Disposition rules:",
    "- ok: good state, no operator action needed",
    "- monitor: usable, but keep an eye on it",
    "- manual_review: source/output mismatch requires human review",
    "- reprocess: current pipeline should be rerun on this document",
    "- cleanup_stale_artifacts: wrong/stale outputs must be deleted or replaced",
    "- extractor_fix: this looks like a systemic parsing/canonicalization bug",
    "",
    `Document: ${quote(manifest.fileName)} (${quote(manifest.fileType)})`,
    `Original file path: ${quote(manifest.originalFilePath)}`,
    "",
    "Current Company-DB document-linked files:",
    listPaths(companyDbArtifactPaths),
    "",
    "Relevant summary/index paths included in workspace:",
    listPaths(domainSummaryPaths),
    "",
    "Required JSON shape:",
    "{",
    '  "audit_summary": string,',
    '  "overall_status": "ok" | "warning" | "fail",',
    '  "overall_confidence": "low" | "medium" | "high",',
    '  "recommended_disposition": "ok" | "monitor" | "manual_review" | "reprocess" | "cleanup_stale_artifacts" | "extractor_fix",',
    '  "checks": [',
    "    {",
    '      "check": string,',
    '      "status": "pass" | "warning" | "fail" | "not_applicable",',
    '      "summary": string,',
    '      "evidence": string',
    "    }",
    "  ],",
    '  "issues": [',
    "    {",
    '      "severity": "low" | "medium" | "high",',
    '      "code": string,',
    '      "issue": string,',
    '      "impact": string,',
    '      "evidence": string,',
    '      "affected_paths": string[]',
    "    }",
    "  ],",
    '  "recommended_actions": string[]',
    "}",
    "",
    "Writing rules:",
    "- Keep issue codes short snake_case tokens.",
    "- Mention exact sheets/pages/rows or exact QMD paths in evidence whenever possible.",
    "- If outputs are missing, say which expected path family is absent.",
    "- If summary looks safer than raw artifacts justify, call that out explicitly.",
    "",
    "Before returning JSON:",
    "- ensure every important mismatch has evidence",
    "- ensure recommended_disposition matches severity",
    "- ensure source_artifact_coverage check is present",
    "",
    "Return valid JSON that matches the schema.",
  ].join("\n");
}
