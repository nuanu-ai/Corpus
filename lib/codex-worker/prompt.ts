import type { CodexArtifactManifest } from "./types";
import {
  renderClarificationAnswers,
  renderTemplateHints,
} from "@/lib/documents/clarifications";

function quotePromptValue(value: unknown): string {
  return JSON.stringify(value ?? "unknown");
}

function listUnits(manifest: CodexArtifactManifest): string {
  return manifest.units
    .map((unit) => {
      const metaBits = [
        `kind=${quotePromptValue(unit.unitKind)}`,
        `slug=${quotePromptValue(unit.slug)}`,
        `source=${quotePromptValue(unit.sourcePath)}`,
      ];
      if (unit.previewPath) metaBits.push(`preview=${quotePromptValue(unit.previewPath)}`);
      if (unit.visualPath) metaBits.push(`visual=${quotePromptValue(unit.visualPath)}`);
      if (unit.metadataPath) metaBits.push(`metadata=${quotePromptValue(unit.metadataPath)}`);
      return `- ${quotePromptValue(unit.title)} (${metaBits.join(", ")})`;
    })
    .join("\n");
}

function formatSourceContext(manifest: CodexArtifactManifest): string | null {
  const sourceContext = manifest.sourceContext;
  if (!sourceContext) return null;

  const lines = [
    `- provider=${quotePromptValue(sourceContext.provider ?? "unknown")}`,
    `- source_path=${quotePromptValue(sourceContext.sourcePath ?? "unknown")}`,
  ];
  if (sourceContext.rootPath) {
    lines.push(`- root_path=${quotePromptValue(sourceContext.rootPath)}`);
  }
  if (sourceContext.connectionLabel) {
    lines.push(`- connection_label=${quotePromptValue(sourceContext.connectionLabel)}`);
  }
  if (sourceContext.ingressSource) {
    lines.push(`- ingress_source=${quotePromptValue(sourceContext.ingressSource)}`);
  }
  if (sourceContext.driveFileId) {
    lines.push(`- drive_file_id=${quotePromptValue(sourceContext.driveFileId)}`);
  }
  if (sourceContext.inferredPeriod) {
    lines.push(
      `- inferred_period=${quotePromptValue(`${sourceContext.inferredPeriod.start}..${sourceContext.inferredPeriod.end}`)}${
        sourceContext.inferredPeriod.label
          ? ` (${quotePromptValue(sourceContext.inferredPeriod.label)})`
          : ""
      }`,
    );
  }

  return lines.join("\n");
}

function renderUploadProvenance(
  provenance: NonNullable<CodexArtifactManifest["clarificationContext"]>["uploadProvenance"],
): string[] {
  if (!provenance) return [];
  const lines: string[] = [];
  if (provenance.sourceUrl) {
    lines.push(`- source_url=${quotePromptValue(provenance.sourceUrl)}`);
  }
  if (provenance.externalDocumentId) {
    lines.push(`- external_document_id=${quotePromptValue(provenance.externalDocumentId)}`);
  }
  if (provenance.agentNotes) {
    lines.push(`- agent_notes=${quotePromptValue(provenance.agentNotes)}`);
  }
  return lines;
}

export function buildCodexPrompt(manifest: CodexArtifactManifest): string {
  const sourceContextSection = formatSourceContext(manifest);
  const uploadProvenanceSection = renderUploadProvenance(
    manifest.clarificationContext?.uploadProvenance,
  );
  const documentAnswersSection = manifest.clarificationContext?.documentAnswers
    ? renderClarificationAnswers(manifest.clarificationContext.documentAnswers)
    : [];
  const templateHintsSection = manifest.clarificationContext?.templateHints
    ? renderTemplateHints(manifest.clarificationContext.templateHints)
    : [];

  return [
    "You are a senior CFO + financial controls analyst.",
    "",
    "You are working on exactly one uploaded document inside an isolated workspace.",
    "Your job is not only to summarize the document, but to decide how the system should route it and what structured data can be trusted.",
    "",
    "You must inspect:",
    "1. the original uploaded file",
    "2. artifacts/manifest.json",
    "3. preview markdown files",
    "4. raw extracted sheet/page artifacts",
    "5. metadata files",
    "6. visual page renders when a unit has visual=... in the unit list",
    "",
    "Primary goals:",
    "1. Determine what this document actually is.",
    "2. Decide the correct target domain for storage.",
    "3. Extract normalized metadata needed by the system.",
    "4. Produce a detailed CFO-grade review of the document.",
    "5. Surface uncertainty, anomalies, integrity issues, and reasons for manual review if needed.",
    "",
    "Important constraints:",
    "- Do not invent values.",
    "- Use only evidence present in the original file or generated artifacts.",
    "- For scanned/image-only PDF pages, visual=... page renders are first-class evidence. Inspect them before concluding that the content is unknown.",
    "- If visual renders show a map, plan, diagram, stamp, signature, table, or handwritten note, describe what is visually evident and keep any uncertain OCR-level text marked as uncertain.",
    "- If a PDF has more sparse pages than rendered images, state that visual coverage is partial and keep the unrendered pages review-gated.",
    "- If uncertain, say so explicitly and lower confidence.",
    "- Prefer detailed, evidence-backed analysis over brevity.",
    "- Every important claim must be tied to a sheet, page, section, row range, or other concrete evidence.",
    "- Return JSON only.",
    "- Determine dominant document language from artifacts first.",
    "- Set normalized_metadata.source_language to a compact language code when possible (for example: en, id, ru, es, fr, de).",
    "- Keep all narrative output in that same language.",
    "- Never switch language based on user/assistant locale.",
    "- Do not translate to English unless the document itself is English.",
    "- Keep review_flags as short machine-friendly snake_case tokens.",
    "",
    "Routing rules:",
    "- Use target_domain = \"finance\" for financial statements, ledgers, trial balances, bank statements, reconciliations, AP/AR schedules, tax-financial support files, and other accounting data.",
    "- Use target_domain = \"knowledge\" for narrative, research, policy, meeting, or general reference material that is not better classified as legal, governance, strategy, operations, or finance.",
    "- Use target_domain = \"legal\" for incorporation docs, contracts, permits, licenses, and legal filings.",
    "- Use target_domain = \"tax\" for tax returns, tax invoices, tax payment evidence, and tax support documents.",
    "- Use target_domain = \"governance\" for board minutes, cap table materials, resolutions, shareholder packages, and financing governance records.",
    "- Use target_domain = \"strategy\" for annual plans, OKRs, KPI definitions, roadmaps, strategic plans, business plans, GTM plans, marketing strategy, growth plans, expansion plans, partner plans, merchant reviews, and business review decks.",
    "- Use target_domain = \"operations\" for SOPs, runbooks, operational logs, maintenance records, and facility/process documents.",
    "- Use target_domain = \"assets\" for fixed asset schedules, registers, equipment, depreciation support, and property/equipment dossiers.",
    "- If none of the above fits cleanly, use target_domain = \"documents\".",
    "- If legal/incorporation cues are present (for example: contract, agreement, term sheet, deed, notary/notarial, akta, pendirian, NIB, izin, sertifikat, Kemenkumham, permit/license), prefer target_domain = \"legal\" even when extraction quality is poor.",
    "- Do not use target_domain = \"knowledge\" for legal/regulatory documents just because extraction failed.",
    "",
    "You must classify document_kind as one of:",
    "- financial_report",
    "- general_ledger",
    "- trial_balance",
    "- bank_statement",
    "- invoice",
    "- receipt",
    "- payroll",
    "- tax_document",
    "- legal_document",
    "- license_document",
    "- operational_document",
    "- mixed_document",
    "- unknown",
    "",
    "For finance documents, infer where possible:",
    "- report_type: balance_sheet | profit_and_loss | cash_flow | general_ledger | trial_balance | ar_aging | ap_aging | bank_reconciliation | budget_vs_actual | other",
    "- book: actual | budget | forecast | unknown",
    "- currency",
    "- reporting period",
    "- entity / business unit / sheet role",
    "- whether the document is monthly, quarterly, annual, or ad hoc",
    "",
    "For review quality:",
    "- identify control failures",
    "- identify broken formulas or #REF! issues",
    "- identify mismatched totals",
    "- identify suspicious sign conventions",
    "- identify missing currency or missing period",
    "- identify duplicated or sparse template sections",
    "- identify whether this document is safe for automatic ingestion or should require review",
    "",
    `Document: ${quotePromptValue(manifest.fileName)} (${quotePromptValue(manifest.fileType)})`,
    `Original file path: ${quotePromptValue(manifest.originalFilePath)}`,
    `Unit count: ${manifest.units.length}`,
    ...(sourceContextSection
      ? ["", "Source context:", sourceContextSection]
      : []),
    ...(uploadProvenanceSection.length > 0
      ? [
          "",
          "Agent-provided upload provenance:",
          ...uploadProvenanceSection,
          "- Treat this as high-priority provenance context, but verify document facts against the file evidence.",
        ]
      : []),
    ...(documentAnswersSection.length > 0
      ? [
          "",
          "User-provided clarification answers for this exact document:",
          ...documentAnswersSection,
          "- Treat these as high-priority hints, but still verify against the workbook or extracted artifacts.",
        ]
      : []),
    ...(templateHintsSection.length > 0
      ? [
          "",
          "Template hints from similar prior uploads:",
          ...templateHintsSection,
          "- These are reusable defaults from the same company and source folder.",
          "- Use them only when they fit the current document evidence.",
        ]
      : []),
    "",
    "Units to cover:",
    listUnits(manifest),
    "",
    "Required JSON shape:",
    "{",
    '  "document_title": string,',
    '  "document_kind": string,',
    '  "target_domain": string,',
    '  "target_entity_type": string,',
    '  "routing_confidence": "low" | "medium" | "high",',
    '  "routing_reasons": string[],',
    '  "requires_review": boolean,',
    '  "review_flags": string[],',
    '  "overall_confidence": "low" | "medium" | "high",',
    '  "document_summary": string,',
    '  "executive_summary": string,',
    '  "key_themes": string[],',
    '  "risks": string[],',
    '  "assumptions": string[],',
    '  "normalized_metadata": {',
    '    "report_type": string | null,',
    '    "book": string | null,',
    '    "currency": string | null,',
    '    "entity": string | null,',
    '    "sheet_name": string | null,',
    '    "period_start": string | null,',
    '    "period_end": string | null,',
    '    "period_label": string | null,',
    '    "company_names_detected": string[],',
    '    "source_language": string | null',
    "  },",
    '  "topline_findings": [',
    "    {",
    '      "label": string,',
    '      "value": string,',
    '      "evidence": string',
    "    }",
    "  ],",
    '  "anomalies": [',
    "    {",
    '      "severity": "low" | "medium" | "high",',
    '      "issue": string,',
    '      "impact": string,',
    '      "evidence": string',
    "    }",
    "  ],",
    '  "ingestion_recommendation": {',
    '    "mode": "auto_ingest" | "needs_review" | "knowledge_only" | "reject",',
    '    "reason": string',
    "  },",
    '  "index_markdown": string,',
    '  "units": [',
    "    {",
    '      "slug": string,',
    '      "title": string,',
    '      "unit_kind": "sheet" | "page" | "file",',
    '      "source_ref": string,',
    '      "confidence": "low" | "medium" | "high",',
    '      "markdown": string,',
    '      "key_figures": string[],',
    '      "risks": string[],',
    '      "assumptions": string[],',
    '      "evidence": string[],',
    '      "candidate_role": string | null',
    "    }",
    "  ]",
    "}",
    "",
    "Detailed writing instructions for document_summary and unit markdown:",
    "- Be specific, not generic.",
    "- Name actual sheets/pages and their roles.",
    "- Include major balances, totals, and movements when visible.",
    "- Mention control problems such as #REF!, broken totals, missing depreciation, abnormal negatives, sparse schedules, or inconsistent labels.",
    "- Explain what the document is useful for downstream.",
    "- State what data is safe to ingest and what should be held for review.",
    "- All narrative text fields must be written in the dominant document language (including index_markdown, document_summary, executive_summary, routing_reasons, key_themes, risks, assumptions, topline/anomaly text, ingestion_recommendation.reason, and units[].markdown).",
    "- The language used in all narrative fields must match normalized_metadata.source_language.",
    "- If the source is truly mixed-language, use the dominant language and encode normalized_metadata.source_language as mixed plus the dominant code (for example: mixed-id).",
    "",
    "Before returning JSON:",
    "- confirm every unit in artifacts/manifest.json is covered exactly once",
    "- confirm the target_domain matches the document's primary purpose",
    "- confirm all dates, periods, and currencies are evidence-based",
    "- confirm no key claim is unsupported",
    "",
    "Return valid JSON that matches the provided schema.",
  ].join("\n");
}
