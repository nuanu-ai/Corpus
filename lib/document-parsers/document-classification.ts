import { parsePeriodFromFileName } from "@/lib/document-parsers/period-utils";

export type DocumentKind = "financial" | "non_financial" | "unclassified";

export interface DocumentClassificationInput {
  fileType: string;
  fileName: string;
  documentType?: string | null;
  transactionsCount: number;
  reportsCount: number;
  sourcePath?: string | null;
}

export interface DocumentClassification {
  document_kind: DocumentKind;
  candidate_domains: string[];
  confidence: number;
  routing_reason: string;
}

const FINANCIAL_DOC_TYPES = new Set<string>([
  "bank_statement",
  "receipt",
  "invoice",
  "payroll_report",
  "pnl_report",
  "profit_and_loss",
  "balance_sheet",
  "bank_balance_snapshot",
  "bank_balance_workbook",
  "trial_balance",
  "general_ledger",
  "financial_statement",
]);

const FINANCIAL_FILENAME_PATTERNS: RegExp[] = [
  /\bfinancial[\s_-]+statement\b/i,
  /\btrial[\s_-]+balance\b/i,
  /(?:^|[\s._-])tb(?:$|[\s._-])/i,
  /\bbalance[\s_-]+sheet\b/i,
  /(?:^|[\s._-])bs(?:$|[\s._-])/i,
  /\bprofit\s*(?:and|&)\s*loss\b/i,
  /\bp&l\b/i,
  /\bgeneral[\s_-]+ledger\b/i,
  /\bcash[\s_-]+flow\b/i,
  /\bstatement[\s_-]+of[\s_-]+financial[\s_-]+position\b/i,
];

const NON_FINANCIAL_DOMAIN_RULES: Array<{ domain: string; patterns: RegExp[] }> = [
  {
    domain: "legal",
    patterns: [
      /\blegal\b/i,
      /\bcontract\b/i,
      /\bagreement\b/i,
      /\bnda\b/i,
      /\blicense\b/i,
      /\blicen[sc]e\b/i,
      /\bpermit\b/i,
      /\bcertificate\b/i,
      /\bregistration\b/i,
      /\blease\b/i,
      /\bzoning\b/i,
      /\bcompliance\b/i,
      /\bregulat(or|ion|ory)\b/i,
      /\bdeed\b/i,
      /\bnotar(y|ial)\b/i,
      /\bakta\b/i,
      /\bperjanjian\b/i,
      /\bpendirian\b/i,
      /\bkemenkumham\b/i,
      /\bnib\b/i,
      /\bizin\b/i,
      /\boss\b/i,
      /\blkpm\b/i,
      /\bsanksi\b/i,
      /\bsanction\b/i,
      /\btanggapan\b/i,
      /\bsertifika(t|si)\b/i,
      /\bterms\b/i,
      /\bpolicy\b/i,
    ],
  },
  {
    domain: "tax",
    patterns: [
      /\btax\b/i,
      /\bnpwp\b/i,
      /\bpajak\b/i,
      /\bpph\b/i,
      /\bppn\b/i,
      /\bvat\b/i,
      /\bgst\b/i,
      /\bwithholding\b/i,
      /\bfiling\b/i,
      /\breturn\b/i,
      /\bdeclaration\b/i,
    ],
  },
  {
    domain: "governance",
    patterns: [
      /\bboard\b/i,
      /\bshareholder\b/i,
      /\binvest(or|ment)\b/i,
      /\bminutes\b/i,
      /\bcap[\s_-]?table\b/i,
      /\bresolution\b/i,
      /\bfunding\b/i,
      /\bboard[\s_-]?pack\b/i,
      /\binvestor[\s_-]?(update|memo|deck|report)\b/i,
    ],
  },
  {
    domain: "strategy",
    patterns: [
      /\bstrategy\b/i,
      /\bstrategic\b/i,
      /\broadmap\b/i,
      /\bokr(s)?\b/i,
      /\bkpi(s)?\b/i,
      /\bannual[\s_-]?plan\b/i,
      /\bbusiness[\s_-]?plan\b/i,
      /\boperating[\s_-]?plan\b/i,
      /\bgrowth[\s_-]?plan\b/i,
      /\bexpansion[\s_-]?plan\b/i,
      /\bgo[\s_-]?to[\s_-]?market\b/i,
      /\bgtm\b/i,
      /\bmarketing[\s_-]?(plan|strategy|calendar)\b/i,
      /\bcampaign[\s_-]?(plan|strategy|calendar)\b/i,
      /\bbrand[\s_-]?strategy\b/i,
      /\bmerchant[\s_-]?(plan|review)\b/i,
      /\bpartner[\s_-]?(plan|review)\b/i,
      /\bquarterly[\s_-]?business[\s_-]?review\b/i,
      /\bqbr\b/i,
      /\bmonthly[\s_-]?business[\s_-]?review\b/i,
      /\bmbr\b/i,
    ],
  },
  {
    domain: "operations",
    patterns: [
      /\boperations?\b/i,
      /\boperational\b/i,
      /\bsop\b/i,
      /\brunbook\b/i,
      /\bguideline(s)?\b/i,
      /\bhandbook\b/i,
      /\bmanual\b/i,
      /\bstandards?\b/i,
      /\bmaintenance\b/i,
      /\bincident\b/i,
      /\bprocess\b/i,
      /\bfacilit(y|ies)\b/i,
      /\bplaybook\b/i,
      /\broll[\s_-]?out\b/i,
      /\bexecution[\s_-]?plan\b/i,
      /\blaunch[\s_-]?plan\b/i,
      /\bcampaign[\s_-]?execution\b/i,
    ],
  },
  {
    domain: "assets",
    patterns: [
      /\basset(s)?\b/i,
      /\bequipment\b/i,
      /\bproperty\b/i,
      /\bvehicle\b/i,
      /\bdepreciation\b/i,
      /\bfixed[\s_-]?asset\b/i,
    ],
  },
];

function uniqueDomains(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeType(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function classifyFinancialByType(docType: string): DocumentClassification | null {
  if (!FINANCIAL_DOC_TYPES.has(docType)) return null;

  if (docType === "invoice") {
    return {
      document_kind: "financial",
      candidate_domains: ["revenue", "documents"],
      confidence: 0.9,
      routing_reason: "document_type=invoice",
    };
  }

  if (docType === "payroll_report") {
    return {
      document_kind: "financial",
      candidate_domains: ["people", "finance", "documents"],
      confidence: 0.85,
      routing_reason: "document_type=payroll_report",
    };
  }

  if (docType === "bank_statement" || docType === "receipt") {
    return {
      document_kind: "financial",
      candidate_domains: ["banking", "expenses", "documents"],
      confidence: 0.85,
      routing_reason: `document_type=${docType}`,
    };
  }

  return {
    document_kind: "financial",
    candidate_domains: ["finance", "documents"],
    confidence: 0.92,
    routing_reason: `document_type=${docType}`,
  };
}

function classifyByNonFinancialHints(hintText: string): DocumentClassification | null {
  const matched = NON_FINANCIAL_DOMAIN_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(hintText)))
    .map((rule) => rule.domain);

  if (matched.length === 0) return null;

  return {
    document_kind: "non_financial",
    candidate_domains: uniqueDomains([...matched, "documents"]),
    confidence: matched.length >= 2 ? 0.82 : 0.72,
    routing_reason: `non_financial_hints:${matched.join(",")}`,
  };
}

function classifyByFinancialHints(input: DocumentClassificationInput): DocumentClassification | null {
  const normalizedHintText = `${input.fileName} ${input.fileType}`
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hasFinancialPattern = FINANCIAL_FILENAME_PATTERNS.some((pattern) =>
    pattern.test(normalizedHintText),
  );
  const hasPeriodHint = parsePeriodFromFileName(input.fileName) !== null;

  if (!hasFinancialPattern && !(hasPeriodHint && /(?:xlsx|xls|csv|tsv|excel)/i.test(input.fileType))) {
    return null;
  }

  const confidence = hasFinancialPattern && hasPeriodHint ? 0.86 : hasFinancialPattern ? 0.78 : 0.66;
  const routingReason = hasFinancialPattern
    ? hasPeriodHint
      ? "financial_filename_hints+period"
      : "financial_filename_hints"
    : "financial_periodic_spreadsheet_hints";

  return {
    document_kind: "financial",
    candidate_domains: ["finance", "documents"],
    confidence,
    routing_reason: routingReason,
  };
}

export function classifyDocumentForIngestion(
  input: DocumentClassificationInput,
): DocumentClassification {
  if (input.reportsCount > 0) {
    return {
      document_kind: "financial",
      candidate_domains: ["finance", "documents"],
      confidence: 0.96,
      routing_reason: "reports_extracted",
    };
  }

  if (input.transactionsCount > 0) {
    return {
      document_kind: "financial",
      candidate_domains: ["banking", "documents"],
      confidence: 0.95,
      routing_reason: "transactions_extracted",
    };
  }

  const docType = normalizeType(input.documentType);
  if (docType) {
    const byType = classifyFinancialByType(docType);
    if (byType) return byType;
  }

  const hintText = `${input.fileName} ${docType} ${input.fileType} ${input.sourcePath ?? ""}`.trim();
  const byFinancialHints = classifyByFinancialHints(input);
  if (byFinancialHints) return byFinancialHints;

  const byHints = classifyByNonFinancialHints(hintText);
  if (byHints) return byHints;

  return {
    document_kind: "unclassified",
    candidate_domains: ["documents"],
    confidence: 0.2,
    routing_reason: "insufficient_signals",
  };
}
