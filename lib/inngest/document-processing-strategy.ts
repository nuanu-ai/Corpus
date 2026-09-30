import {
  classifyDocumentForIngestion,
  type DocumentClassification,
} from "@/lib/document-parsers/document-classification";
import {
  triagePdf,
  type PdfTableDensity,
  type PdfTriageInput,
  type PdfTriageResult,
} from "@/lib/document-parsers/pdf-triage";

export type DocumentProcessingStrategy =
  | "simplified_narrative"
  | "codex_finance"
  | "codex_ocr"
  | "codex_ambiguous";

export type DocumentProcessingDispatchTarget =
  | "knowledge_handler"
  | "standard_ingest"
  | "simplified_narrative"
  | "codex_worker";

export type DocumentProcessingDispatchEvent =
  | "document/knowledge-uploaded"
  | "document/uploaded"
  | "document/simplified-narrative-uploaded";

export interface DocumentProcessingStrategyInput {
  fileName: string;
  fileType: string;
  documentType?: string | null;
  textSample?: string | null;
  pdfTriage?: PdfTriageInput | PdfTriageResult;
  sourcePath?: string | null;
}

export interface DocumentProcessingStrategyResult {
  processingStrategy: DocumentProcessingStrategy;
  dispatchTarget: DocumentProcessingDispatchTarget;
  dispatchEvent: DocumentProcessingDispatchEvent | null;
  classification: DocumentClassification;
  routingConfidence: number;
  extractionConfidence: number | null;
  ocrNeeded: boolean;
  tableDensity: PdfTableDensity | null;
  language: string | null;
  reasons: string[];
}

function toText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function detectLanguageFromTextSample(textSample: string | null | undefined): string | null {
  const sample = toText(textSample).toLowerCase();
  if (!sample) return null;

  const tokens = sample.match(/\p{L}+/gu) ?? [];
  if (tokens.length < 5) return null;

  const englishStopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "not",
    "are",
    "is",
  ]);
  const indonesianStopWords = new Set([
    "yang",
    "dan",
    "untuk",
    "dengan",
    "dalam",
    "pada",
    "ini",
    "adalah",
    "tidak",
    "dari",
  ]);

  let englishMatches = 0;
  let indonesianMatches = 0;

  for (const token of tokens) {
    if (englishStopWords.has(token)) englishMatches += 1;
    if (indonesianStopWords.has(token)) indonesianMatches += 1;
  }

  if (englishMatches >= 2 && englishMatches > indonesianMatches) return "en";
  if (indonesianMatches >= 2 && indonesianMatches > englishMatches) return "id";
  return null;
}

function resolveDispatch(
  processingStrategy: DocumentProcessingStrategy,
): Pick<DocumentProcessingStrategyResult, "dispatchTarget" | "dispatchEvent"> {
  switch (processingStrategy) {
    case "simplified_narrative":
      return {
        dispatchTarget: "simplified_narrative",
        dispatchEvent: "document/simplified-narrative-uploaded",
      };
    case "codex_finance":
    case "codex_ocr":
    case "codex_ambiguous":
      return {
        dispatchTarget: "codex_worker",
        dispatchEvent: null,
      };
  }
}

function resolveKnowledgeDispatch(): Pick<
  DocumentProcessingStrategyResult,
  "dispatchTarget" | "dispatchEvent"
> {
  return {
    dispatchTarget: "knowledge_handler",
    dispatchEvent: "document/knowledge-uploaded",
  };
}

function buildClassification(input: DocumentProcessingStrategyInput): DocumentClassification {
  return classifyDocumentForIngestion({
    fileType: input.fileType,
    fileName: input.fileName,
    documentType: input.documentType ?? null,
    transactionsCount: 0,
    reportsCount: 0,
    sourcePath: input.sourcePath ?? null,
  });
}

function asPdfTriageResult(value: PdfTriageInput | PdfTriageResult | undefined): PdfTriageResult | null {
  if (!value) return null;
  if ("verdict" in value) return value;
  return triagePdf(value);
}

export function resolveDocumentProcessingStrategy(
  input: DocumentProcessingStrategyInput,
): DocumentProcessingStrategyResult {
  const classification = buildClassification(input);
  const language = detectLanguageFromTextSample(input.textSample);
  const pdfTriage = asPdfTriageResult(input.pdfTriage);
  const normalizedFileType = input.fileType.trim().toLowerCase();

  if (normalizedFileType === "knowledge") {
    const dispatch = resolveKnowledgeDispatch();
    return {
      processingStrategy: "simplified_narrative",
      ...dispatch,
      classification,
      routingConfidence: 0.95,
      extractionConfidence: null,
      ocrNeeded: false,
      tableDensity: null,
      language,
      reasons: ["knowledge_filetype"],
    };
  }

  if (normalizedFileType === "excel" || normalizedFileType === "csv") {
    const dispatch = resolveDispatch("codex_finance");
    return {
      processingStrategy: "codex_finance",
      ...dispatch,
      classification,
      routingConfidence: 0.98,
      extractionConfidence: null,
      ocrNeeded: false,
      tableDensity: null,
      language,
      reasons: ["structured_spreadsheet_filetype"],
    };
  }

  if (normalizedFileType === "ofx" || normalizedFileType === "qif") {
    const dispatch = resolveDispatch("codex_finance");
    return {
      processingStrategy: "codex_finance",
      ...dispatch,
      classification,
      routingConfidence: 0.99,
      extractionConfidence: null,
      ocrNeeded: false,
      tableDensity: null,
      language,
      reasons: ["structured_financial_export_filetype"],
    };
  }

  if (normalizedFileType === "image") {
    const dispatch = resolveDispatch("codex_ocr");
    return {
      processingStrategy: "codex_ocr",
      ...dispatch,
      classification,
      routingConfidence: 0.99,
      extractionConfidence: null,
      ocrNeeded: true,
      tableDensity: null,
      language,
      reasons: ["image_requires_ocr"],
    };
  }

  if (normalizedFileType !== "pdf") {
    const dispatch = resolveDispatch("codex_ambiguous");
    return {
      processingStrategy: "codex_ambiguous",
      ...dispatch,
      classification,
      routingConfidence: 0.5,
      extractionConfidence: null,
      ocrNeeded: false,
      tableDensity: null,
      language,
      reasons: ["unsupported_filetype_for_v1_triage"],
    };
  }

  if (classification.document_kind === "financial" && classification.confidence >= 0.7) {
    const dispatch = resolveDispatch("codex_finance");
    return {
      processingStrategy: "codex_finance",
      ...dispatch,
      classification,
      routingConfidence: classification.confidence,
      extractionConfidence: null,
      ocrNeeded: false,
      tableDensity: pdfTriage?.tableDensity ?? null,
      language,
      reasons: [classification.routing_reason],
    };
  }

  if (!pdfTriage) {
    const dispatch = resolveDispatch("codex_ambiguous");
    return {
      processingStrategy: "codex_ambiguous",
      ...dispatch,
      classification,
      routingConfidence: classification.confidence,
      extractionConfidence: null,
      ocrNeeded: false,
      tableDensity: null,
      language,
      reasons: ["missing_pdf_triage_signals", classification.routing_reason],
    };
  }

  if (pdfTriage.ocrNeeded || pdfTriage.verdict === "ocr_required") {
    const dispatch = resolveDispatch("codex_ocr");
    return {
      processingStrategy: "codex_ocr",
      ...dispatch,
      classification,
      routingConfidence: Math.max(classification.confidence, 0.85),
      extractionConfidence: pdfTriage.textCoverage,
      ocrNeeded: true,
      tableDensity: pdfTriage.tableDensity,
      language,
      reasons: [...pdfTriage.reasons, classification.routing_reason],
    };
  }

  if (
    pdfTriage.verdict === "born_digital_text" &&
    pdfTriage.pageCount <= 3 &&
    (pdfTriage.tableDensity === "none" || pdfTriage.tableDensity === "low") &&
    classification.document_kind === "non_financial" &&
    classification.confidence >= 0.7
  ) {
    const dispatch = resolveDispatch("simplified_narrative");
    return {
      processingStrategy: "simplified_narrative",
      ...dispatch,
      classification,
      routingConfidence: classification.confidence,
      extractionConfidence: pdfTriage.textCoverage,
      ocrNeeded: false,
      tableDensity: pdfTriage.tableDensity,
      language,
      reasons: [...pdfTriage.reasons, classification.routing_reason],
    };
  }

  const dispatch = resolveDispatch("codex_ambiguous");
  return {
    processingStrategy: "codex_ambiguous",
    ...dispatch,
    classification,
    routingConfidence: classification.confidence,
    extractionConfidence: pdfTriage.textCoverage,
    ocrNeeded: false,
    tableDensity: pdfTriage.tableDensity,
    language,
    reasons: [...pdfTriage.reasons, classification.routing_reason],
  };
}
