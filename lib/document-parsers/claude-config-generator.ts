// ---------------------------------------------------------------------------
// Claude-powered ReportConfig generator
//
// Samples an Excel workbook, sends structural data to Claude, and returns
// a validated ReportConfig for the financial report extraction pipeline.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import type { ReportConfig } from "./report-types";
import {
  REPORT_TYPES,
  BOOK_TYPES,
  EXTRACTION_TYPES,
  validateReportConfig,
} from "./report-types";

// ── Sheet classification ────────────────────────────────────────────────

/**
 * Patterns that indicate a non-financial sheet (cover pages, notes, etc.).
 * Case-insensitive match against sheet names.
 */
const SKIP_PATTERNS = [
  /^cover$/i,
  /^notes?$/i,
  /^table\s+of\s+contents$/i,
  /^index$/i,
  /^toc$/i,
  /^instructions?$/i,
  /^disclaimer$/i,
  /^summary\s+notes$/i,
  /^sheet\s*info$/i,
];

function isSkipSheet(name: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(name.trim()));
}

// ── Workbook sampling ───────────────────────────────────────────────────

export interface SheetSample {
  name: string;
  headers: string[][];
  data_rows: string[][];
  total_rows: number;
  total_cols: number;
}

export interface WorkbookSample {
  sheet_names: string[];
  skipped_sheets: string[];
  financial_sheets: SheetSample[];
}

interface GenerateReportConfigOptions {
  feedback?: string;
  onUsage?: (
    usage: { inputTokens: number; outputTokens: number },
    phase: "initial" | "retry",
  ) => Promise<void> | void;
}

/**
 * Extract column headers from a sheet, handling multi-row headers.
 *
 * Scans the first 10 rows to find header rows — contiguous rows of mostly
 * string values before numeric data begins.
 */
function extractHeaders(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
): string[][] {
  const headers: string[][] = [];
  const maxScan = Math.min(range.s.r + 10, range.e.r);

  for (let r = range.s.r; r <= maxScan; r++) {
    const row: string[] = [];
    let stringCount = 0;
    let numberCount = 0;
    let hasValue = false;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
        row.push(String(cell.v));
        hasValue = true;
        if (typeof cell.v === "string") stringCount++;
        if (typeof cell.v === "number") numberCount++;
      } else {
        row.push("");
      }
    }

    if (!hasValue) {
      // Empty row — could be separator between headers and data
      if (headers.length > 0) break;
      continue;
    }

    // If more numbers than strings, this is probably data, not a header
    if (numberCount > stringCount && headers.length > 0) break;

    // If row is mostly strings, treat as header
    if (stringCount >= numberCount) {
      headers.push(row);
    } else {
      break;
    }
  }

  return headers;
}

/**
 * Extract the first N data rows (after headers) from a sheet.
 */
function extractDataRows(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  headerRowCount: number,
  maxRows: number,
): string[][] {
  const rows: string[][] = [];
  const startRow = range.s.r + headerRowCount;

  for (
    let r = startRow;
    r <= range.e.r && rows.length < maxRows;
    r++
  ) {
    const row: string[] = [];
    let hasValue = false;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
        row.push(String(cell.v));
        hasValue = true;
      } else {
        row.push("");
      }
    }

    if (hasValue) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Sample a single sheet: extract headers + first ~30 data rows.
 */
function sampleSheet(
  name: string,
  sheet: XLSX.WorkSheet,
): SheetSample | null {
  const ref = sheet["!ref"];
  if (!ref) return null;

  const range = XLSX.utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;

  const headers = extractHeaders(sheet, range);
  const dataRows = extractDataRows(sheet, range, headers.length, 30);

  // Skip sheets with no useful data
  if (headers.length === 0 && dataRows.length === 0) return null;

  return {
    name,
    headers,
    data_rows: dataRows,
    total_rows: totalRows,
    total_cols: totalCols,
  };
}

/**
 * Sample a workbook: classify sheets, extract headers and data rows.
 *
 * - Cover/notes/index sheets are skipped.
 * - If more than 10 financial sheets, takes first 5 + evenly spaced selection.
 * - Empty sheets are excluded from samples.
 */
export function sampleWorkbook(workbook: XLSX.WorkBook): WorkbookSample {
  const allNames = workbook.SheetNames;
  const skipped: string[] = [];
  const financialNames: string[] = [];

  for (const name of allNames) {
    if (isSkipSheet(name)) {
      skipped.push(name);
    } else {
      financialNames.push(name);
    }
  }

  // Decide which sheets to sample
  let toSample: string[];
  if (financialNames.length <= 10) {
    toSample = financialNames;
  } else {
    // First 5 + evenly spaced selection from the rest
    const first5 = financialNames.slice(0, 5);
    const remaining = financialNames.slice(5);
    const step = Math.max(1, Math.floor(remaining.length / 5));
    const selected: string[] = [];
    for (let i = 0; i < remaining.length && selected.length < 5; i += step) {
      selected.push(remaining[i]);
    }
    toSample = [...first5, ...selected];
  }

  const samples: SheetSample[] = [];
  for (const name of toSample) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const sample = sampleSheet(name, sheet);
    if (sample) {
      samples.push(sample);
    }
  }

  return {
    sheet_names: allNames,
    skipped_sheets: skipped,
    financial_sheets: samples,
  };
}

// ── JSON Schema for tool_use ────────────────────────────────────────────

const REPORT_CONFIG_SCHEMA = {
  type: "object" as const,
  required: [
    "report_type",
    "sheet_names",
    "extraction_type",
    "columns",
    "detection_rules",
    "book",
    "currency",
  ],
  properties: {
    report_type: {
      type: "string" as const,
      enum: [...REPORT_TYPES],
      description:
        "The type of financial report: profit_and_loss, balance_sheet, trial_balance, general_ledger, or financial_statement",
    },
    sheet_names: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Sheet names to extract data from",
    },
    extraction_type: {
      type: "string" as const,
      enum: [...EXTRACTION_TYPES],
      description:
        '"section" for P&L/balance sheets with named sections, "tabular" for flat tables like trial balances',
    },
    columns: {
      type: "object" as const,
      additionalProperties: { type: "string" as const },
      description:
        'Map of logical column names (e.g. "account_name", "amount", "debit", "credit") to Excel column letters (e.g. "A", "B", "C")',
    },
    sections: {
      type: "object" as const,
      additionalProperties: {
        type: "object" as const,
        properties: {
          start: {
            type: "string" as const,
            description: "Regex or literal to detect section start",
          },
          end: {
            type: "string" as const,
            description:
              "Regex or literal to detect section end (optional)",
          },
        },
        required: ["start"],
      },
      description:
        "Section markers for section-based extraction (required if extraction_type is 'section')",
    },
    detection_rules: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          field: {
            type: "string" as const,
            description:
              'Field to match (e.g. "sheet_name", "header_row", "cell")',
          },
          pattern: {
            type: "string" as const,
            description: "Regex pattern or literal to match",
          },
          weight: {
            type: "number" as const,
            description: "Match weight 0-1 (default 1)",
          },
        },
        required: ["field", "pattern"],
      },
      description:
        "Rules for auto-detecting this report type in future workbooks",
    },
    book: {
      type: "string" as const,
      enum: [...BOOK_TYPES],
      description:
        "Whether this is actual/historical data, a budget, or a forecast",
    },
    currency: {
      type: "string" as const,
      pattern: "^[A-Z]{3}$",
      description: "ISO 4217 currency code (e.g. USD, EUR, GBP)",
    },
  },
};

// ── Prompt construction ─────────────────────────────────────────────────

function buildPrompt(
  sample: WorkbookSample,
  feedback?: string,
): string {
  const sheetSummaries = sample.financial_sheets
    .map((s) => {
      const headerText =
        s.headers.length > 0
          ? s.headers.map((row) => row.join(" | ")).join("\n    ")
          : "(no headers detected)";

      const dataText =
        s.data_rows.length > 0
          ? s.data_rows
              .slice(0, 10)
              .map((row) => row.join(" | "))
              .join("\n    ")
          : "(no data rows)";

      return `
  Sheet: "${s.name}" (${s.total_rows} rows x ${s.total_cols} cols)
  Headers:
    ${headerText}
  Sample data (first ${Math.min(s.data_rows.length, 10)} of ${s.data_rows.length} rows):
    ${dataText}`;
    })
    .join("\n");

  const basePrompt = `Analyze this Excel workbook and generate a ReportConfig for extracting financial data.

WORKBOOK STRUCTURE:
- All sheet names: ${JSON.stringify(sample.sheet_names)}
- Skipped sheets (non-financial): ${JSON.stringify(sample.skipped_sheets)}
- Financial sheets sampled: ${sample.financial_sheets.length}
${sheetSummaries}

YOUR TASK:
1. Identify the report_type (profit_and_loss, balance_sheet, trial_balance, general_ledger, or financial_statement)
2. Map logical column names to Excel column letters (A, B, C, ...)
3. If the report has sections (like Revenue, COGS, Operating Expenses in a P&L), identify section markers and use extraction_type "section"
4. If it's a flat table (like a trial balance with debit/credit columns), use extraction_type "tabular"
5. Detect the book type: "actual" for historical/real data, "budget" for budget data, "forecast" for projections
6. Detect the currency from any visible currency symbols, codes, or context
7. Create detection_rules that would help identify similar reports in the future

Use the generate_report_config tool to return your analysis.`;

  if (!feedback || feedback.trim().length === 0) {
    return basePrompt;
  }

  return `${basePrompt}

ADDITIONAL RECOVERY CONTEXT:
${feedback}

IMPORTANT:
- The previous extraction attempt underperformed.
- Re-evaluate sheet_names, columns, extraction_type, and section markers.
- Prefer preserving all financial rows over overly narrow matching.`;
}

// ── Main generator ──────────────────────────────────────────────────────

/**
 * Generate a ReportConfig for a workbook by sending structural samples
 * to Claude and validating the response.
 *
 * Retries once with error feedback if initial config fails validation.
 */
export async function generateReportConfig(
  workbook: XLSX.WorkBook,
  options: GenerateReportConfigOptions = {},
): Promise<ReportConfig> {
  const sample = sampleWorkbook(workbook);

  if (sample.financial_sheets.length === 0) {
    throw new Error(
      "No financial sheets found in workbook. All sheets were either empty or classified as non-financial (cover, notes, index, etc.).",
    );
  }

  const anthropic = new Anthropic();
  const prompt = buildPrompt(sample, options.feedback);

  const config = await callClaudeForConfig(anthropic, prompt, options.onUsage, "initial");

  // Validate
  const result = validateReportConfig(config);
  if (result.valid) {
    return config;
  }

  // Retry once with error feedback
  const retryPrompt = `${prompt}

IMPORTANT: Your previous attempt produced an invalid config with these errors:
${result.errors.map((e) => `- ${e}`).join("\n")}

Please fix these issues and try again.`;

  const retryConfig = await callClaudeForConfig(anthropic, retryPrompt, options.onUsage, "retry");

  const retryResult = validateReportConfig(retryConfig);
  if (!retryResult.valid) {
    throw new Error(
      `Failed to generate valid ReportConfig after retry. Errors: ${retryResult.errors.join("; ")}`,
    );
  }

  return retryConfig;
}

/**
 * Call Claude with the generate_report_config tool and extract the config.
 */
async function callClaudeForConfig(
  anthropic: Anthropic,
  prompt: string,
  onUsage: GenerateReportConfigOptions["onUsage"],
  phase: "initial" | "retry",
): Promise<ReportConfig> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    tools: [
      {
        name: "generate_report_config",
        description:
          "Generate a ReportConfig for extracting financial data from an Excel workbook",
        input_schema: REPORT_CONFIG_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "generate_report_config" },
    messages: [{ role: "user", content: prompt }],
  });
  await onUsage?.(
    {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    phase,
  );

  // Extract tool_use block
  const toolBlock = response.content.find(
    (block) => block.type === "tool_use" && block.name === "generate_report_config",
  );

  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error(
      "Claude did not return a generate_report_config tool_use block",
    );
  }

  return toolBlock.input as ReportConfig;
}
