import { parseCsv } from "./csv-parser";
import { parseOcrDocument } from "./ocr";
import { parseOfx } from "./ofx-parser";
import { parseQif } from "./qif-parser";
import { parseBankBalanceWorkbook } from "./bank-balance-parser";
import { parseStructuredReport } from "./report-parser";
import { parseUnstructuredFinancialReport } from "./unstructured-financial";
import type { CanonicalFinanceBundle } from "./canonical-finance-types";
import type { ExtractedReport } from "./report-types";

export interface ParsedTransaction {
  date: Date;
  amount: number; // positive = credit, negative = debit
  /**
   * ISO 4217. `null` means the source did not declare a currency for this row
   * (no currency column, empty CURDEF, etc.). Consumers must resolve this to a
   * concrete code before persisting (e.g. via `resolveTxnCurrency` from
   * `lib/finance/resolve-currency.ts`) — never default to "USD" silently.
   */
  currency: string | null;
  description: string | null;
  merchantName: string | null;
  sourceRef: string | null;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  confidence: number; // 0-1
  metadata?: Record<string, unknown>;
  /** Extracted financial reports (P&L, balance sheet, etc.) — optional, backward-compatible */
  reports?: ExtractedReport[];
  /** Canonical finance records extracted from finance workbooks. */
  canonicalFinance?: CanonicalFinanceBundle;
  /** Bank balance daily workbook snapshot extracted from CFO cash balance sheets. */
  bankBalanceSnapshot?: import("./bank-balance-parser").BankBalanceSnapshot;
  /** Detected document type (e.g. "bank_statement", "profit_and_loss") — optional */
  documentType?: string;
  /** Whether the result needs human review before further processing — optional */
  needsReview?: boolean;
}

export interface ParseDocumentSourceContext {
  sourcePath?: string | null;
  rootPath?: string | null;
  ingressSource?: string | null;
  connectionLabel?: string | null;
}

export interface ParseDocumentSheetHint {
  sheetName?: string | null;
  sheetOrdinal?: number | null;
  title?: string | null;
  candidateRole?: string | null;
}

export interface ParseDocumentContext {
  companyId?: string;
  sourceContext?: ParseDocumentSourceContext;
  sheetHints?: ParseDocumentSheetHint[];
  clarificationAnswers?: Record<string, string>;
}

export async function parseDocument(
  buffer: Buffer,
  fileType: string,
  fileName: string,
  context?: ParseDocumentContext,
): Promise<ParseResult> {
  switch (fileType) {
    case "csv":
      return parseCsv(buffer, fileName);

    case "excel": {
      const bankBalanceResult = parseBankBalanceWorkbook(buffer, fileName);
      if (bankBalanceResult) return bankBalanceResult;

      // If companyId is available, try structured report extraction first
      if (context?.companyId) {
        const reportResult = await parseStructuredReport(
          buffer,
          fileName,
          context.companyId,
          context.sourceContext,
          context.sheetHints,
          context.clarificationAnswers,
        );
        if (reportResult) return reportResult;
      }
      // Fall through to CSV parser for flat transaction files
      return parseCsv(buffer, fileName);
    }

    case "ofx":
      return parseOfx(buffer);

    case "qif":
      return parseQif(buffer);

    case "pdf": {
      const unstructured = await parseUnstructuredFinancialReport(
        buffer,
        fileType,
        fileName,
        {
          companyId: context?.companyId,
          sourceContext: context?.sourceContext,
        },
      );
      // REL-5: when the bridge itself fails (timeout/SIGKILL/non-zero exit),
      // parseUnstructuredFinancialReport returns null after logging the reason,
      // so we intentionally fall through to the Mindee OCR fallback below.
      if (unstructured) return unstructured;
      try {
        return await parseOcrDocument(buffer, fileType);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("MINDEE_API_KEY is not configured")
        ) {
          // Degrade gracefully when OCR provider credentials are absent.
          // This keeps ingestion alive (doc can still be routed/reviewed).
          return {
            transactions: [],
            confidence: 0,
            metadata: {
              provider: "mindee",
              skipped: true,
              reason: "MINDEE_API_KEY is not configured",
            },
            documentType: "unknown",
            needsReview: true,
          };
        }
        throw error;
      }
    }

    case "image":
      return parseOcrDocument(buffer, fileType);

    default:
      throw new Error(`Unsupported file type: "${fileType}"`);
  }
}
