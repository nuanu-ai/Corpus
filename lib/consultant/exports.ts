import { existsSync } from "fs";
import { basename, resolve } from "path";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import pdfMakeRuntime from "pdfmake";
import * as XLSX from "xlsx";

import {
  writeConsultantArtifactBinaryFile,
  writeConsultantArtifactFile,
} from "./workspace";

export type ConsultantExportFormat = "xlsx" | "csv" | "tsv" | "pdf" | "docx";

export type ConsultantExportCell = string | number | boolean | null;

export interface ConsultantExportSheetInput {
  name?: string;
  columns?: string[];
  rows: Array<Record<string, ConsultantExportCell>>;
}

export interface ConsultantExportFileInput {
  companyId: string;
  threadId: string;
  title: string;
  format: ConsultantExportFormat;
  fileName?: string;
  sheets: ConsultantExportSheetInput[];
}

export interface ConsultantExportFileResult {
  fullPath: string;
  relativePath: string;
  rootPath: string;
  mimeType: string;
  fileName: string;
  sheetCount: number;
  rowCount: number;
  sourceSheetCount: number;
  generatedSheetCount: number;
  features: string[];
}

type ColumnKind =
  | "text"
  | "number"
  | "integer"
  | "percentage"
  | "currency_like"
  | "boolean"
  | "mixed";

interface ColumnProfile {
  key: string;
  header: string;
  kind: ColumnKind;
  numeric: boolean;
  width: number;
}

interface PreparedSheet {
  name: string;
  columns: string[];
  rows: Array<Record<string, ConsultantExportCell>>;
  profiles: ColumnProfile[];
  worksheet: XLSX.WorkSheet;
  chartDataSheetName: string | null;
}

const MAX_SHEET_NAME_LENGTH = 31;
const MAX_COLUMN_WIDTH = 40;
const MIN_COLUMN_WIDTH = 10;
const MAX_CHART_METRICS = 3;
const EXECUTIVE_SUMMARY_SHEET = "Executive Summary";
const PDF_PORTRAIT_MAX_COLUMNS = 6;
const PDF_LANDSCAPE_MAX_COLUMNS = 9;
const DOCX_MAX_COLUMNS_PER_TABLE = 8;
const DOCX_MAX_ROWS_PER_SHEET = 250;
const DOCX_TABLE_BORDER = { style: BorderStyle.SINGLE, size: 1, color: "D8DEE9" } as const;
const DOCX_TABLE_BORDERS = {
  top: DOCX_TABLE_BORDER,
  bottom: DOCX_TABLE_BORDER,
  left: DOCX_TABLE_BORDER,
  right: DOCX_TABLE_BORDER,
  insideHorizontal: DOCX_TABLE_BORDER,
  insideVertical: DOCX_TABLE_BORDER,
} as const;
const DOCX_CELL_BORDERS = {
  top: DOCX_TABLE_BORDER,
  bottom: DOCX_TABLE_BORDER,
  left: DOCX_TABLE_BORDER,
  right: DOCX_TABLE_BORDER,
} as const;
const PDF_FONT_REGULAR_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  resolve(process.cwd(), "node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf"),
];
const PDF_FONT_BOLD_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  resolve(process.cwd(), "node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf"),
];

type PdfMakeCreatedDocument = {
  getBuffer: () => Promise<Buffer | Uint8Array | ArrayBuffer>;
};

type PdfMakeRuntime = {
  addFonts: (fonts: Record<string, Record<string, string>>) => void;
  setLocalAccessPolicy?: (callback: (path: string) => boolean) => void;
  setUrlAccessPolicy?: (callback: (url: string) => boolean) => void;
  createPdf: (documentDefinitions: Record<string, unknown>) => PdfMakeCreatedDocument;
};

const pdfMake = pdfMakeRuntime as unknown as PdfMakeRuntime;
let pdfMakeConfigured = false;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "export";
}

function normalizeSheetName(name: string | undefined, index: number): string {
  const fallback = `Sheet${index + 1}`;
  const candidate = (name?.trim() || fallback)
    .replace(/[\\/?*\[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .slice(0, MAX_SHEET_NAME_LENGTH);
  return candidate || fallback;
}

function reserveSheetName(
  desired: string | undefined,
  index: number,
  usedNames: Set<string>,
): string {
  const normalized = normalizeSheetName(desired, index);
  if (!usedNames.has(normalized)) {
    usedNames.add(normalized);
    return normalized;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const suffixText = ` ${suffix}`;
    const candidate = `${normalized.slice(0, MAX_SHEET_NAME_LENGTH - suffixText.length)}${suffixText}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Unable to allocate unique worksheet name for ${normalized}`);
}

function inferColumns(sheet: ConsultantExportSheetInput): string[] {
  if (Array.isArray(sheet.columns) && sheet.columns.length > 0) {
    return sheet.columns;
  }

  const seen = new Set<string>();
  for (const row of sheet.rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
      }
    }
  }
  return Array.from(seen);
}

function normalizeRows(
  rows: Array<Record<string, ConsultantExportCell>>,
  columns: string[],
): Array<Record<string, ConsultantExportCell>> {
  return rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => [column, row[column] ?? null]),
    ),
  );
}

function isNumber(value: ConsultantExportCell): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: ConsultantExportCell): value is boolean {
  return typeof value === "boolean";
}

function inferColumnKind(
  header: string,
  values: ConsultantExportCell[],
): ColumnKind {
  const nonNullValues = values.filter((value) => value !== null);
  if (nonNullValues.length === 0) {
    return "text";
  }

  const numericValues = nonNullValues.filter(isNumber);
  const booleanValues = nonNullValues.filter(isBoolean);

  if (numericValues.length === nonNullValues.length) {
    const headerKey = header.toLowerCase();
    const allIntegers = numericValues.every((value) => Number.isInteger(value));
    const looksPercentage =
      /(margin|rate|ratio|share|pct|percent|percentage|utilization|occupancy)/.test(
        headerKey,
      ) && numericValues.every((value) => Math.abs(value) <= 1);
    const looksCurrency = /(revenue|expense|expenses|cost|cash|balance|profit|income|arr|mrr|budget|salary|payroll|tax|amount|value|price|total|usd|idr|eur|gbp|rub)/.test(
      headerKey,
    );

    if (looksPercentage) {
      return "percentage";
    }
    if (looksCurrency) {
      return "currency_like";
    }
    return allIntegers ? "integer" : "number";
  }

  if (booleanValues.length === nonNullValues.length) {
    return "boolean";
  }

  return "mixed";
}

function getNumberFormat(kind: ColumnKind): string | null {
  switch (kind) {
    case "percentage":
      return "0.0%";
    case "currency_like":
      return "#,##0.00;[Red]-#,##0.00";
    case "integer":
      return "#,##0;[Red]-#,##0";
    case "number":
      return "#,##0.00;[Red]-#,##0.00";
    default:
      return null;
  }
}

function formatValuePreview(value: ConsultantExportCell, kind: ColumnKind): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    switch (kind) {
      case "percentage":
        return `${(value * 100).toFixed(1)}%`;
      case "integer":
        return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
      case "currency_like":
      case "number":
        return value.toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });
      default:
        return String(value);
    }
  }
  return String(value);
}

function inferColumnProfiles(
  columns: string[],
  rows: Array<Record<string, ConsultantExportCell>>,
): ColumnProfile[] {
  return columns.map((column) => {
    const values = rows.map((row) => row[column] ?? null);
    const kind = inferColumnKind(column, values);
    const width = Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(
        MIN_COLUMN_WIDTH,
        column.length + 2,
        ...values.map((value) => formatValuePreview(value, kind).length + 2),
      ),
    );

    return {
      key: column,
      header: column,
      kind,
      numeric: ["number", "integer", "percentage", "currency_like"].includes(kind),
      width,
    };
  });
}

function buildWorksheet(
  rows: Array<Record<string, ConsultantExportCell>>,
  columns: string[],
): XLSX.WorkSheet {
  if (columns.length === 0) {
    return XLSX.utils.aoa_to_sheet([["No data"]]);
  }

  if (rows.length === 0) {
    return XLSX.utils.aoa_to_sheet([columns]);
  }

  return XLSX.utils.json_to_sheet(rows, {
    header: columns,
    skipHeader: false,
  });
}

function applyWorksheetPresentation(
  worksheet: XLSX.WorkSheet,
  profiles: ColumnProfile[],
  rowCount: number,
): void {
  if (profiles.length === 0) {
    return;
  }

  worksheet["!cols"] = profiles.map((profile) => ({ wch: profile.width }));
  worksheet["!rows"] = [{ hpt: 22 }];

  if (rowCount > 0) {
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { c: 0, r: 0 },
        e: { c: profiles.length - 1, r: rowCount },
      }),
    };
  }

  for (let columnIndex = 0; columnIndex < profiles.length; columnIndex += 1) {
    const numberFormat = getNumberFormat(profiles[columnIndex].kind);
    if (!numberFormat) {
      continue;
    }

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex + 1 });
      const cell = worksheet[address] as XLSX.CellObject | undefined;
      if (!cell || cell.t !== "n") {
        continue;
      }
      cell.z = numberFormat;
    }
  }
}

function escapeSheetNameForFormula(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function ensureSheets(
  sheets: ConsultantExportSheetInput[],
): ConsultantExportSheetInput[] {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error("At least one sheet is required for spreadsheet export");
  }

  return sheets.map((sheet) => ({
    ...sheet,
    rows: Array.isArray(sheet.rows) ? sheet.rows : [],
  }));
}

function defaultFileName(title: string, format: ConsultantExportFormat): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(title)}.${format}`;
}

function resolveExistingFontPath(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function configurePdfMake(): void {
  if (pdfMakeConfigured) return;

  const regular = resolveExistingFontPath(PDF_FONT_REGULAR_CANDIDATES);
  const bold = resolveExistingFontPath(PDF_FONT_BOLD_CANDIDATES) ?? regular;

  if (!regular || !bold) {
    throw new Error("No usable font files found for PDF export");
  }

  const allowedFontPaths = new Set([regular, bold]);
  pdfMake.setLocalAccessPolicy?.((path) => allowedFontPaths.has(path));
  pdfMake.setUrlAccessPolicy?.(() => false);
  pdfMake.addFonts({
    Report: {
      normal: regular,
      bold,
      italics: regular,
      bolditalics: bold,
    },
  });
  pdfMakeConfigured = true;
}

function chunkColumns(columns: string[], maxColumns: number): string[][] {
  if (columns.length <= maxColumns) {
    return [columns];
  }

  const chunks: string[][] = [];
  for (let index = 0; index < columns.length; index += maxColumns) {
    chunks.push(columns.slice(index, index + maxColumns));
  }
  return chunks;
}

function shouldUseLandscapePdf(sheets: ConsultantExportSheetInput[]): boolean {
  return sheets.some((sheet) => inferColumns(sheet).length > PDF_PORTRAIT_MAX_COLUMNS);
}

function pdfCell(text: string, options?: {
  header?: boolean;
  numeric?: boolean;
  muted?: boolean;
}): Record<string, unknown> {
  return {
    text,
    style: options?.header ? "tableHeader" : options?.muted ? "mutedCell" : "tableCell",
    alignment: options?.numeric ? "right" : "left",
    noWrap: false,
  };
}

function buildPdfTable(input: {
  columns: string[];
  rows: Array<Record<string, ConsultantExportCell>>;
  profiles: ColumnProfile[];
}): Record<string, unknown> {
  const profileByKey = new Map(input.profiles.map((profile) => [profile.key, profile]));
  const body = [
    input.columns.map((column) => pdfCell(column, { header: true })),
    ...(input.rows.length > 0
      ? input.rows.map((row) =>
          input.columns.map((column) => {
            const profile = profileByKey.get(column);
            const value = row[column] ?? null;
            return pdfCell(formatValuePreview(value, profile?.kind ?? "text"), {
              numeric: profile?.numeric,
            });
          }),
        )
      : [
          [
            {
              text: "No rows returned for this sheet.",
              colSpan: input.columns.length,
              style: "mutedCell",
            },
            ...Array.from({ length: Math.max(0, input.columns.length - 1) }, () => ({ text: "" })),
          ],
        ]),
  ];

  return {
    table: {
      headerRows: 1,
      widths: input.columns.map(() => "*"),
      body,
      dontBreakRows: false,
      keepWithHeaderRows: 1,
    },
    layout: {
      hLineColor: () => "#E2E8F0",
      vLineColor: () => "#E2E8F0",
      hLineWidth: (rowIndex: number) => (rowIndex === 0 || rowIndex === 1 ? 0.8 : 0.35),
      vLineWidth: () => 0.35,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 5,
      paddingBottom: () => 5,
      fillColor: (rowIndex: number) => {
        if (rowIndex === 0) return "#0F172A";
        return rowIndex % 2 === 0 ? "#F8FAFC" : null;
      },
    },
    margin: [0, 4, 0, 14],
  };
}

function toPdfBuffer(buffer: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(buffer)) return buffer;
  return Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
}

async function createPdfExportBuffer(input: {
  title: string;
  sheets: ConsultantExportSheetInput[];
  rowCount: number;
}): Promise<Buffer> {
  configurePdfMake();

  const generatedAt = new Date();
  const landscape = shouldUseLandscapePdf(input.sheets);
  const maxColumnsPerBlock = landscape ? PDF_LANDSCAPE_MAX_COLUMNS : PDF_PORTRAIT_MAX_COLUMNS;
  const content: Array<Record<string, unknown>> = [
    {
      text: input.title,
      style: "title",
      margin: [0, 0, 0, 8],
    },
    {
      text: `Generated ${generatedAt.toISOString()} | ${input.sheets.length} sheet(s) | ${input.rowCount} row(s)`,
      style: "kicker",
      margin: [0, 0, 0, 18],
    },
  ];

  for (const [sheetIndex, rawSheet] of input.sheets.entries()) {
    const columns = inferColumns(rawSheet);
    const normalizedRows = normalizeRows(rawSheet.rows, columns);
    const profiles = inferColumnProfiles(columns, normalizedRows);
    const sheetName = normalizeSheetName(rawSheet.name, sheetIndex);
    const renderedColumns = columns.length > 0 ? columns : ["No data"];
    const columnBlocks = chunkColumns(renderedColumns, maxColumnsPerBlock);

    content.push({
      text: `${sheetName} (${normalizedRows.length} rows)`,
      style: "sectionTitle",
      margin: [0, sheetIndex === 0 ? 0 : 10, 0, 4],
    });

    for (const [blockIndex, blockColumns] of columnBlocks.entries()) {
      if (columnBlocks.length > 1) {
        content.push({
          text: `Column block ${blockIndex + 1} of ${columnBlocks.length}`,
          style: "kicker",
          margin: [0, 0, 0, 4],
        });
      }

      content.push(buildPdfTable({
        columns: blockColumns,
        rows: normalizedRows,
        profiles: profiles.filter((profile) => blockColumns.includes(profile.key)),
      }));
    }
  }

  const docDefinition: Record<string, unknown> = {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [34, 48, 34, 42],
    defaultStyle: {
      font: "Report",
      fontSize: landscape ? 7.2 : 8.2,
      lineHeight: 1.15,
      color: "#111827",
    },
    info: {
      title: input.title,
      subject: "Consultant export",
      author: "Corpus",
      creator: "Corpus",
      producer: "Corpus",
      creationDate: generatedAt,
    },
    styles: {
      title: {
        fontSize: 21,
        bold: true,
        color: "#0F172A",
      },
      kicker: {
        fontSize: 8,
        color: "#64748B",
      },
      sectionTitle: {
        fontSize: 12,
        bold: true,
        color: "#0F172A",
      },
      tableHeader: {
        fontSize: landscape ? 6.8 : 7.5,
        bold: true,
        color: "#FFFFFF",
      },
      tableCell: {
        fontSize: landscape ? 6.8 : 7.5,
        color: "#111827",
      },
      mutedCell: {
        fontSize: landscape ? 6.8 : 7.5,
        color: "#64748B",
        italics: true,
      },
      footer: {
        fontSize: 7,
        color: "#94A3B8",
      },
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: "Corpus", style: "footer" },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: "right", style: "footer" },
      ],
      margin: [34, 0, 34, 0],
    }),
    content,
  };

  return toPdfBuffer(await pdfMake.createPdf(docDefinition).getBuffer());
}

function normalizeDocxText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createDocxParagraph(input: {
  text: string;
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  bold?: boolean;
  color?: string;
  size?: number;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  spacingAfter?: number;
}): Paragraph {
  return new Paragraph({
    heading: input.heading,
    alignment: input.alignment,
    spacing: { after: input.spacingAfter ?? 160 },
    children: [
      new TextRun({
        text: normalizeDocxText(input.text) || " ",
        bold: input.bold,
        color: input.color ?? "111827",
        size: input.size ?? 22,
      }),
    ],
  });
}

function createDocxCell(
  text: string,
  options: {
    header?: boolean;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {},
): TableCell {
  return new TableCell({
    borders: DOCX_CELL_BORDERS,
    margins: {
      top: 100,
      bottom: 100,
      left: 110,
      right: 110,
    },
    shading: options.header
      ? { type: ShadingType.CLEAR, fill: "E8EEF7", color: "auto" }
      : undefined,
    children: [
      new Paragraph({
        alignment: options.alignment,
        children: [
          new TextRun({
            text: normalizeDocxText(text) || " ",
            bold: options.header,
            color: options.header ? "0F172A" : "1F2937",
            size: options.header ? 18 : 17,
          }),
        ],
      }),
    ],
  });
}

function createDocxTable(columns: string[], rows: string[][]): Table {
  const safeColumns = columns.length > 0 ? columns : ["No data"];
  const safeRows = rows.length > 0 ? rows : [safeColumns.map(() => "")];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: DOCX_TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: safeColumns.map((column) => createDocxCell(column, { header: true })),
      }),
      ...safeRows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: safeColumns.map((_, columnIndex) =>
              createDocxCell(row[columnIndex] ?? ""),
            ),
          }),
      ),
    ],
  });
}

function createDocxMetricSummaryTable(sheet: PreparedSheet): Table | null {
  const numericProfiles = sheet.profiles.filter((profile) => profile.numeric);
  if (numericProfiles.length === 0) {
    return null;
  }

  const rows = numericProfiles.map((profile) => {
    const values = sheet.rows
      .map((row) => row[profile.key] ?? null)
      .filter(isNumber);
    if (values.length === 0) {
      return [profile.header, "0", "n/a", "n/a", "n/a", "n/a"];
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    const average = total / values.length;
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);

    return [
      profile.header,
      values.length.toLocaleString("en-US"),
      profile.kind === "percentage" ? "n/a" : formatValuePreview(total, profile.kind),
      formatValuePreview(average, profile.kind),
      formatValuePreview(minimum, profile.kind),
      formatValuePreview(maximum, profile.kind),
    ];
  });

  return createDocxTable(["Metric", "Count", "Total", "Average", "Minimum", "Maximum"], rows);
}

async function createDocxExportBuffer(input: {
  title: string;
  sheets: ConsultantExportSheetInput[];
  rowCount: number;
  generatedAt: Date;
}): Promise<Buffer> {
  const usedNames = new Set<string>();
  const preparedSheets = buildPreparedSheets(input.sheets, usedNames);
  const children: Array<Paragraph | Table> = [
    createDocxParagraph({
      text: input.title,
      heading: HeadingLevel.TITLE,
      bold: true,
      size: 36,
      spacingAfter: 180,
    }),
    createDocxParagraph({
      text: `Generated ${input.generatedAt.toISOString()} | ${preparedSheets.length} section(s) | ${input.rowCount} row(s)`,
      color: "64748B",
      size: 19,
      spacingAfter: 260,
    }),
    createDocxParagraph({
      text: "Executive summary",
      heading: HeadingLevel.HEADING_1,
      bold: true,
      size: 28,
      spacingAfter: 120,
    }),
    createDocxTable(
      ["Section", "Rows", "Columns", "Numeric metrics"],
      preparedSheets.map((sheet) => [
        sheet.name,
        sheet.rows.length.toLocaleString("en-US"),
        sheet.columns.length.toLocaleString("en-US"),
        sheet.profiles.filter((profile) => profile.numeric).length.toLocaleString("en-US"),
      ]),
    ),
    createDocxParagraph({ text: " ", spacingAfter: 240 }),
  ];

  for (const sheet of preparedSheets) {
    const visibleColumns = sheet.columns.slice(0, DOCX_MAX_COLUMNS_PER_TABLE);
    const visibleRows = sheet.rows.slice(0, DOCX_MAX_ROWS_PER_SHEET);
    const truncatedColumns = sheet.columns.length > visibleColumns.length;
    const truncatedRows = sheet.rows.length > visibleRows.length;

    children.push(
      createDocxParagraph({
        text: sheet.name,
        heading: HeadingLevel.HEADING_1,
        bold: true,
        size: 28,
        spacingAfter: 80,
      }),
      createDocxParagraph({
        text: `${sheet.rows.length.toLocaleString("en-US")} row(s), ${sheet.columns.length.toLocaleString("en-US")} column(s).`,
        color: "64748B",
        size: 19,
        spacingAfter: 120,
      }),
    );

    const metricSummaryTable = createDocxMetricSummaryTable(sheet);
    if (metricSummaryTable) {
      children.push(
        createDocxParagraph({
          text: "Metric summary",
          heading: HeadingLevel.HEADING_2,
          bold: true,
          size: 24,
          spacingAfter: 80,
        }),
        metricSummaryTable,
        createDocxParagraph({ text: " ", spacingAfter: 180 }),
      );
    }

    if (sheet.columns.length === 0) {
      children.push(
        createDocxParagraph({
          text: "No tabular data was provided for this section.",
          color: "64748B",
          spacingAfter: 180,
        }),
      );
      continue;
    }

    if (truncatedRows || truncatedColumns) {
      children.push(
        createDocxParagraph({
          text: `Data table preview is limited to ${visibleRows.length.toLocaleString("en-US")} of ${sheet.rows.length.toLocaleString("en-US")} row(s) and ${visibleColumns.length.toLocaleString("en-US")} of ${sheet.columns.length.toLocaleString("en-US")} column(s). Use XLSX/CSV for full raw-table exports.`,
          color: "92400E",
          size: 18,
          spacingAfter: 120,
        }),
      );
    }

    children.push(
      createDocxParagraph({
        text: "Data table",
        heading: HeadingLevel.HEADING_2,
        bold: true,
        size: 24,
        spacingAfter: 80,
      }),
      createDocxTable(
        visibleColumns,
        visibleRows.length > 0
          ? visibleRows.map((row) =>
              visibleColumns.map((column) => {
                const profile = sheet.profiles.find((candidate) => candidate.key === column);
                const value = row[column] ?? null;
                return formatValuePreview(value, profile?.kind ?? "mixed");
              }),
            )
          : [visibleColumns.map(() => "")],
      ),
      createDocxParagraph({ text: " ", spacingAfter: 240 }),
    );
  }

  const document = new Document({
    title: input.title,
    subject: "Consultant DOCX export",
    creator: "Corpus",
    description: "Generated consultant report",
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

function buildPreparedSheets(
  sheets: ConsultantExportSheetInput[],
  usedNames: Set<string>,
): PreparedSheet[] {
  return sheets.map((sheet, index) => {
    const columns = inferColumns(sheet);
    const normalizedRows = normalizeRows(sheet.rows, columns);
    const profiles = inferColumnProfiles(columns, normalizedRows);
    const name = reserveSheetName(sheet.name, index, usedNames);
    const worksheet = buildWorksheet(normalizedRows, columns);
    applyWorksheetPresentation(worksheet, profiles, normalizedRows.length);

    return {
      name,
      columns,
      rows: normalizedRows,
      profiles,
      worksheet,
      chartDataSheetName: null,
    };
  });
}

function buildChartDataSheet(
  preparedSheet: PreparedSheet,
  usedNames: Set<string>,
): { name: string; worksheet: XLSX.WorkSheet } | null {
  if (preparedSheet.rows.length === 0) {
    return null;
  }

  const dimensionProfile =
    preparedSheet.profiles.find((profile) => !profile.numeric) ?? preparedSheet.profiles[0];
  const metricProfiles = preparedSheet.profiles
    .filter((profile) => profile.numeric && profile.key !== dimensionProfile.key)
    .slice(0, MAX_CHART_METRICS);

  if (metricProfiles.length === 0) {
    return null;
  }

  const chartColumns = [dimensionProfile.key, ...metricProfiles.map((profile) => profile.key)];
  const chartRows = normalizeRows(preparedSheet.rows, chartColumns);
  const chartProfiles = inferColumnProfiles(chartColumns, chartRows);
  const chartWorksheet = buildWorksheet(chartRows, chartColumns);
  applyWorksheetPresentation(chartWorksheet, chartProfiles, chartRows.length);

  return {
    name: reserveSheetName(`${preparedSheet.name} Chart Data`, 0, usedNames),
    worksheet: chartWorksheet,
  };
}

function buildExecutiveSummarySheet(
  title: string,
  preparedSheets: PreparedSheet[],
  usedNames: Set<string>,
  generatedAt: Date,
): { name: string; worksheet: XLSX.WorkSheet; features: string[] } {
  const summarySheetName = reserveSheetName(EXECUTIVE_SUMMARY_SHEET, 0, usedNames);
  const chartReadyCount = preparedSheets.filter(
    (sheet) => sheet.chartDataSheetName !== null,
  ).length;
  const features = [
    "executive_summary",
    "formula_metrics",
    "column_formats",
    "autofilter",
    ...(chartReadyCount > 0 ? ["chart_ready_sheets"] : []),
  ];

  const rows: ConsultantExportCell[][] = [
    ["Executive Summary"],
    ["Report Title", title],
    ["Generated At", generatedAt.toISOString()],
    ["Source Sheets", preparedSheets.length],
    ["Workbook Features", features.join(", ")],
    [],
    ["Sheet", "Rows", "Metric", "Total", "Average", "Minimum", "Maximum", "Chart Data Sheet"],
  ];

  const summaryRowOffset = rows.length;
  const metricDescriptors: Array<{
    rowNumber: number;
    sheetName: string;
    profile: ColumnProfile | null;
    rowCount: number;
  }> = [];

  for (const preparedSheet of preparedSheets) {
    const numericProfiles = preparedSheet.profiles.filter((profile) => profile.numeric);

    if (numericProfiles.length === 0) {
      const rowNumber = rows.length + 1;
      rows.push([
        preparedSheet.name,
        preparedSheet.rows.length,
        "No numeric metrics",
        null,
        null,
        null,
        null,
        preparedSheet.chartDataSheetName,
      ]);
      metricDescriptors.push({
        rowNumber,
        sheetName: preparedSheet.name,
        profile: null,
        rowCount: preparedSheet.rows.length,
      });
      continue;
    }

    for (const profile of numericProfiles) {
      const rowNumber = rows.length + 1;
      rows.push([
        preparedSheet.name,
        preparedSheet.rows.length,
        profile.header,
        null,
        null,
        null,
        null,
        preparedSheet.chartDataSheetName,
      ]);
      metricDescriptors.push({
        rowNumber,
        sheetName: preparedSheet.name,
        profile,
        rowCount: preparedSheet.rows.length,
      });
    }
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 24 },
    { wch: 10 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
  ];
  const summaryRows: XLSX.RowInfo[] = [];
  summaryRows[0] = { hpt: 24 };
  summaryRows[6] = { hpt: 22 };
  worksheet["!rows"] = summaryRows;

  if (rows.length > summaryRowOffset) {
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { c: 0, r: summaryRowOffset - 1 },
        e: { c: 7, r: rows.length - 1 },
      }),
    };
  }

  const countCell = worksheet["B4"] as XLSX.CellObject | undefined;
  if (countCell && countCell.t === "n") {
    countCell.z = "#,##0";
  }

  for (const descriptor of metricDescriptors) {
    const rowsCell = worksheet[XLSX.utils.encode_cell({ c: 1, r: descriptor.rowNumber - 1 })] as
      | XLSX.CellObject
      | undefined;
    if (rowsCell && rowsCell.t === "n") {
      rowsCell.z = "#,##0";
    }

    if (!descriptor.profile || descriptor.rowCount === 0) {
      continue;
    }

    const columnIndex = preparedSheets
      .find((sheet) => sheet.name === descriptor.sheetName)
      ?.columns.indexOf(descriptor.profile.key);

    if (typeof columnIndex !== "number" || columnIndex < 0) {
      continue;
    }

    const excelColumn = XLSX.utils.encode_col(columnIndex);
    const rangeRef = `${escapeSheetNameForFormula(descriptor.sheetName)}!${excelColumn}2:${excelColumn}${descriptor.rowCount + 1}`;
    const numberFormat = getNumberFormat(descriptor.profile.kind);
    const totalAddress = XLSX.utils.encode_cell({ c: 3, r: descriptor.rowNumber - 1 });
    const averageAddress = XLSX.utils.encode_cell({ c: 4, r: descriptor.rowNumber - 1 });
    const minAddress = XLSX.utils.encode_cell({ c: 5, r: descriptor.rowNumber - 1 });
    const maxAddress = XLSX.utils.encode_cell({ c: 6, r: descriptor.rowNumber - 1 });

    if (descriptor.profile.kind !== "percentage") {
      worksheet[totalAddress] = {
        t: "n",
        f: `SUM(${rangeRef})`,
        ...(numberFormat ? { z: numberFormat } : {}),
      };
    }

    worksheet[averageAddress] = {
      t: "n",
      f: `AVERAGE(${rangeRef})`,
      ...(numberFormat ? { z: numberFormat } : {}),
    };
    worksheet[minAddress] = {
      t: "n",
      f: `MIN(${rangeRef})`,
      ...(numberFormat ? { z: numberFormat } : {}),
    };
    worksheet[maxAddress] = {
      t: "n",
      f: `MAX(${rangeRef})`,
      ...(numberFormat ? { z: numberFormat } : {}),
    };
  }

  return {
    name: summarySheetName,
    worksheet,
    features,
  };
}

export function getConsultantExportMimeType(
  format: ConsultantExportFormat,
): string {
  switch (format) {
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv":
      return "text/csv; charset=utf-8";
    case "tsv":
      return "text/tab-separated-values; charset=utf-8";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}

export async function createConsultantExportFile(
  input: ConsultantExportFileInput,
): Promise<ConsultantExportFileResult> {
  const sheets = ensureSheets(input.sheets);
  const fileName = input.fileName?.trim() || defaultFileName(input.title, input.format);
  const rowCount = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);

  if (input.format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    const preparedSheets = buildPreparedSheets(sheets, usedNames);
    const chartSheets = preparedSheets.flatMap((preparedSheet) => {
      const chartSheet = buildChartDataSheet(preparedSheet, usedNames);
      preparedSheet.chartDataSheetName = chartSheet?.name ?? null;
      return chartSheet ? [chartSheet] : [];
    });
    const executiveSummary = buildExecutiveSummarySheet(
      input.title,
      preparedSheets,
      usedNames,
      new Date(),
    );

    XLSX.utils.book_append_sheet(workbook, executiveSummary.worksheet, executiveSummary.name);
    preparedSheets.forEach((preparedSheet) => {
      XLSX.utils.book_append_sheet(workbook, preparedSheet.worksheet, preparedSheet.name);
    });
    chartSheets.forEach((chartSheet) => {
      XLSX.utils.book_append_sheet(workbook, chartSheet.worksheet, chartSheet.name);
    });

    workbook.Props = {
      Title: input.title,
      Subject: "Consultant export",
      Author: "Corpus",
      CreatedDate: new Date(),
    };

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
      cellStyles: true,
    }) as Buffer;

    const file = await writeConsultantArtifactBinaryFile({
      companyId: input.companyId,
      threadId: input.threadId,
      title: input.title,
      fileName,
      destination: "exports",
      content: buffer,
    });

    return {
      ...file,
      fileName: basename(file.fullPath),
      mimeType: getConsultantExportMimeType("xlsx"),
      rowCount,
      sheetCount: 1 + preparedSheets.length + chartSheets.length,
      sourceSheetCount: preparedSheets.length,
      generatedSheetCount: 1 + chartSheets.length,
      features: executiveSummary.features,
    };
  }

  if (input.format === "pdf") {
    const buffer = await createPdfExportBuffer({
      title: input.title,
      sheets,
      rowCount,
    });

    const file = await writeConsultantArtifactBinaryFile({
      companyId: input.companyId,
      threadId: input.threadId,
      title: input.title,
      fileName,
      destination: "exports",
      content: buffer,
    });

    return {
      ...file,
      fileName: basename(file.fullPath),
      mimeType: getConsultantExportMimeType("pdf"),
      rowCount,
      sheetCount: sheets.length,
      sourceSheetCount: sheets.length,
      generatedSheetCount: 0,
      features: [
        "pdf_export",
        "pdfmake_layout",
        "wrapped_tables",
        "auto_orientation",
        shouldUseLandscapePdf(sheets) ? "landscape_layout" : "portrait_layout",
      ],
    };
  }

  if (input.format === "docx") {
    const generatedAt = new Date();
    const buffer = await createDocxExportBuffer({
      title: input.title,
      sheets,
      rowCount,
      generatedAt,
    });
    const hasPreviewLimits = sheets.some(
      (sheet) =>
        inferColumns(sheet).length > DOCX_MAX_COLUMNS_PER_TABLE ||
        sheet.rows.length > DOCX_MAX_ROWS_PER_SHEET,
    );

    const file = await writeConsultantArtifactBinaryFile({
      companyId: input.companyId,
      threadId: input.threadId,
      title: input.title,
      fileName,
      destination: "exports",
      content: buffer,
    });

    return {
      ...file,
      fileName: basename(file.fullPath),
      mimeType: getConsultantExportMimeType("docx"),
      rowCount,
      sheetCount: sheets.length,
      sourceSheetCount: sheets.length,
      generatedSheetCount: 0,
      features: [
        "docx_export",
        "formatted_sections",
        "metric_summary_tables",
        "data_tables",
        ...(hasPreviewLimits ? ["preview_limited_tables"] : []),
      ],
    };
  }

  const columns = inferColumns(sheets[0]);
  const normalizedRows = normalizeRows(sheets[0].rows, columns);
  const worksheet = buildWorksheet(normalizedRows, columns);
  const delimiter = input.format === "tsv" ? "\t" : ",";
  const textContent = XLSX.utils.sheet_to_csv(worksheet, {
    FS: delimiter,
  });

  const file = await writeConsultantArtifactFile({
    companyId: input.companyId,
    threadId: input.threadId,
    title: input.title,
    fileName,
    destination: "exports",
    content: textContent,
  });

  return {
    ...file,
    fileName: basename(file.fullPath),
    mimeType: getConsultantExportMimeType(input.format),
    rowCount,
    sheetCount: 1,
    sourceSheetCount: 1,
    generatedSheetCount: 0,
    features: ["delimited_export"],
  };
}
