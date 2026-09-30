/**
 * Render a LegalComparisonOutput as a human-readable markdown report.
 *
 * This is what gets written to the chat_artifact filePath and shown in the chat
 * when a legal comparison job reaches awaiting_review. Pure — unit-tested.
 */
import type { LegalComparisonOutput } from "@/lib/legal/job";

/** Escape backslashes + pipes + collapse newlines/whitespace so text is safe
 * inside a markdown table cell (prevents table-break injection). */
function cell(s: string): string {
  if (!s) return "";
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape leading markdown chars (#, *, -, `, [) so a bullet item doesn't
 * inject headings/code/etc that break the list structure. */
function bulletItem(s: string): string {
  if (!s) return "";
  return s
    .replace(/^([#*\-`\[\]])/, "\\$1")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bulletList(items: readonly string[], heading: string): string[] {
  if (!items.length) return [];
  return [`## ${heading}`, ...items.map((i) => `- ${bulletItem(i)}`), ""];
}

export function renderComparisonMarkdown(output: LegalComparisonOutput): string {
  const lines: string[] = ["# Contract comparison", ""];

  const confidence =
    output.sameDocumentTypeConfidence != null
      ? ` · Same-type confidence: ${(output.sameDocumentTypeConfidence * 100).toFixed(0)}%`
      : "";
  lines.push(`**Overall risk:** ${output.overallRiskLevel}${confidence}`, "");
  // Defensive: schema requires non-empty summary, but guard against malformed data.
  lines.push("## Summary", output.summary || "(no summary)", "");

  if (output.clauseDifferences.length > 0) {
    // modelText/targetText omitted for compactness; available in metadata JSON.
    lines.push("## Clause differences");
    lines.push("| Clause | Change | Risk | Note |");
    lines.push("|---|---|---|---|");
    for (const d of output.clauseDifferences) {
      lines.push(`| ${cell(d.clause)} | ${d.change} | ${d.riskLevel ?? "—"} | ${cell(d.note ?? "")} |`);
    }
    lines.push("");
  }

  lines.push(...bulletList(output.missingClauses, "Missing clauses (in model, absent from target)"));
  lines.push(...bulletList(output.extraClauses, "Extra clauses (in target, absent from model)"));
  lines.push(...bulletList(output.aliasFindings, "Alias findings"));
  lines.push(...bulletList(output.entityMigrationFindings, "Entity migration findings"));
  lines.push(...bulletList(output.openQuestions, "Open questions (need human confirmation)"));
  lines.push(...bulletList(output.sourceReferences, "Source references"));
  lines.push(...bulletList(output.extractionCaveats, "Extraction caveats"));

  if (output.draftAgreementMarkdown) {
    // Fence the draft so unclosed code/HTML inside it can't corrupt the report.
    lines.push("## Draft (template-aligned)", "");
    lines.push("```markdown");
    lines.push(output.draftAgreementMarkdown.trim());
    lines.push("```", "");
  }
  lines.push(...bulletList(output.draftChangeLog ?? [], "Draft change log"));
  lines.push(...bulletList(output.fieldsNeedingHumanConfirmation ?? [], "Fields needing human confirmation"));

  return lines.join("\n").trim() + "\n";
}
