import type {
  CodexArtifactManifest,
  CodexAuditCheck,
  CodexAuditIssue,
  CodexAuditOutput,
} from "./types";

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function validateChecks(value: unknown): CodexAuditCheck[] {
  if (!Array.isArray(value)) {
    throw new Error("Codex audit output checks must be an array.");
  }

  return value.map((item, index) => {
    const check = requireRecord(item, `Codex audit checks[${index}]`);
    const status = check.status;
    if (
      status !== "pass" &&
      status !== "warning" &&
      status !== "fail" &&
      status !== "not_applicable"
    ) {
      throw new Error(`Codex audit checks[${index}].status is invalid.`);
    }

    return {
      check: requireString(check.check, `Codex audit checks[${index}].check`),
      status,
      summary: requireString(check.summary, `Codex audit checks[${index}].summary`),
      evidence: requireString(check.evidence, `Codex audit checks[${index}].evidence`),
    };
  });
}

function validateIssues(value: unknown): CodexAuditIssue[] {
  if (!Array.isArray(value)) {
    throw new Error("Codex audit output issues must be an array.");
  }

  return value.map((item, index) => {
    const issue = requireRecord(item, `Codex audit issues[${index}]`);
    const severity = issue.severity;
    if (severity !== "low" && severity !== "medium" && severity !== "high") {
      throw new Error(`Codex audit issues[${index}].severity is invalid.`);
    }

    return {
      severity,
      code: requireString(issue.code, `Codex audit issues[${index}].code`),
      issue: requireString(issue.issue, `Codex audit issues[${index}].issue`),
      impact: requireString(issue.impact, `Codex audit issues[${index}].impact`),
      evidence: requireString(issue.evidence, `Codex audit issues[${index}].evidence`),
      affected_paths: requireStringArray(
        issue.affected_paths,
        `Codex audit issues[${index}].affected_paths`,
      ),
    };
  });
}

export function buildCodexAuditOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "audit_summary",
      "overall_status",
      "overall_confidence",
      "recommended_disposition",
      "checks",
      "issues",
      "recommended_actions",
    ],
    properties: {
      audit_summary: { type: "string", minLength: 1 },
      overall_status: {
        type: "string",
        enum: ["ok", "warning", "fail"],
      },
      overall_confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      recommended_disposition: {
        type: "string",
        enum: [
          "ok",
          "monitor",
          "manual_review",
          "reprocess",
          "cleanup_stale_artifacts",
          "extractor_fix",
        ],
      },
      checks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["check", "status", "summary", "evidence"],
          properties: {
            check: { type: "string", minLength: 1 },
            status: {
              type: "string",
              enum: ["pass", "warning", "fail", "not_applicable"],
            },
            summary: { type: "string", minLength: 1 },
            evidence: { type: "string", minLength: 1 },
          },
        },
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "code", "issue", "impact", "evidence", "affected_paths"],
          properties: {
            severity: { type: "string", enum: ["low", "medium", "high"] },
            code: { type: "string", minLength: 1 },
            issue: { type: "string", minLength: 1 },
            impact: { type: "string", minLength: 1 },
            evidence: { type: "string", minLength: 1 },
            affected_paths: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
      recommended_actions: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

export function validateCodexAuditOutput(
  value: unknown,
  manifest: CodexArtifactManifest,
): CodexAuditOutput {
  const output = requireRecord(value, "Codex audit output");
  const overallStatus = output.overall_status;
  if (overallStatus !== "ok" && overallStatus !== "warning" && overallStatus !== "fail") {
    throw new Error("Codex audit output overall_status is invalid.");
  }

  const overallConfidence = output.overall_confidence;
  if (overallConfidence !== "low" && overallConfidence !== "medium" && overallConfidence !== "high") {
    throw new Error("Codex audit output overall_confidence is invalid.");
  }

  const recommendedDisposition = output.recommended_disposition;
  if (
    recommendedDisposition !== "ok" &&
    recommendedDisposition !== "monitor" &&
    recommendedDisposition !== "manual_review" &&
    recommendedDisposition !== "reprocess" &&
    recommendedDisposition !== "cleanup_stale_artifacts" &&
    recommendedDisposition !== "extractor_fix"
  ) {
    throw new Error("Codex audit output recommended_disposition is invalid.");
  }

  const checks = validateChecks(output.checks);
  const issues = validateIssues(output.issues);
  const recommendedActions = requireStringArray(
    output.recommended_actions,
    "Codex audit output recommended_actions",
  );

  if (checks.length === 0) {
    throw new Error("Codex audit output must contain at least one check.");
  }

  if (manifest.units.length > 0) {
    const sourceCoverageCheck = checks.find((check) => check.check === "source_artifact_coverage");
    if (!sourceCoverageCheck) {
      throw new Error("Codex audit output is missing source_artifact_coverage check.");
    }
  }

  return {
    audit_summary: requireString(output.audit_summary, "Codex audit output audit_summary"),
    overall_status: overallStatus,
    overall_confidence: overallConfidence,
    recommended_disposition: recommendedDisposition,
    checks,
    issues,
    recommended_actions: recommendedActions,
  };
}
