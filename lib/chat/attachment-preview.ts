import * as XLSX from "xlsx";

import { extractUnstructuredText } from "@/lib/document-parsers/unstructured-text";

export const MAX_EPHEMERAL_ATTACHMENT_PREVIEW_BYTES = 10 * 1024 * 1024;
export const MAX_EPHEMERAL_ATTACHMENT_TEXT_CHARS = 12_000;
const MAX_SHEET_ROWS_PREVIEW = 25;
const MAX_SHEET_COLS_PREVIEW = 30;

const TEXT_LIKE_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "application/x-yaml",
  "text/yaml",
  "text/html",
]);

const WORKBOOK_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

const DOCX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function truncateText(text: string, maxChars = MAX_EPHEMERAL_ATTACHMENT_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function previewWorkbook(buffer: Buffer, fileName: string): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const lines: string[] = [];
  lines.push(`# ${fileName}`);
  lines.push("");
  lines.push(`Workbook with ${wb.SheetNames.length} sheet(s):`);

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const ref = sheet["!ref"];
    if (!ref) {
      lines.push(`\n## "${name}" (empty)`);
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const totalRows = range.e.r - range.s.r + 1;
    const totalCols = range.e.c - range.s.c + 1;
    lines.push(`\n## "${name}" ${totalRows} rows x ${totalCols} cols`);

    const previewMaxCol = Math.min(range.s.c + MAX_SHEET_COLS_PREVIEW - 1, range.e.c);
    const previewMaxRow = Math.min(range.s.r + MAX_SHEET_ROWS_PREVIEW - 1, range.e.r);
    const rows: string[][] = [];

    for (let r = range.s.r; r <= previewMaxRow; r += 1) {
      const row: string[] = [];
      for (let c = range.s.c; c <= previewMaxCol; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        row.push(
          cell?.v !== undefined && cell?.v !== null
            ? String(cell.v).replace(/\s+/g, " ").slice(0, 60)
            : "",
        );
      }
      rows.push(row);
    }

    if (rows.length === 0) continue;
    const colWidths = rows[0]!.map((_, idx) =>
      Math.min(20, Math.max(...rows.map((r) => (r[idx] ?? "").length))),
    );
    lines.push("```");
    for (const row of rows) {
      lines.push(row.map((cell, idx) => cell.padEnd(colWidths[idx] ?? 0)).join(" | "));
    }
    if (totalRows > MAX_SHEET_ROWS_PREVIEW) {
      lines.push(`... +${totalRows - MAX_SHEET_ROWS_PREVIEW} more rows`);
    }
    if (totalCols > MAX_SHEET_COLS_PREVIEW) {
      lines.push(`... +${totalCols - MAX_SHEET_COLS_PREVIEW} more cols`);
    }
    lines.push("```");
  }

  return truncateText(lines.join("\n"));
}

function previewText(buffer: Buffer, fileName: string, mimeType: string): string {
  const raw = buffer.toString("utf8");
  const text = truncateText(raw, MAX_EPHEMERAL_ATTACHMENT_TEXT_CHARS);
  const truncated = raw.length > text.length;
  return [
    `# ${fileName}`,
    "",
    `Mime: ${mimeType || "application/octet-stream"}. Size: ${buffer.length} bytes.`,
    truncated ? `(truncated to first ${MAX_EPHEMERAL_ATTACHMENT_TEXT_CHARS} chars)` : "",
    "",
    "```",
    text,
    "```",
  ].filter(Boolean).join("\n");
}

async function previewDocx(buffer: Buffer, fileName: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return [
    `# ${fileName}`,
    "",
    truncateText(result.value.trim() || "(empty DOCX text extraction)"),
  ].join("\n");
}

async function previewUnstructured(input: {
  buffer: Buffer;
  fileName: string;
  fileType: "pdf" | "image";
}): Promise<string | null> {
  try {
    const result = await extractUnstructuredText(input.buffer, {
      fileType: input.fileType,
      fileName: input.fileName,
    });
    const text = result.text.trim();
    if (!text) return null;
    return [
      `# ${input.fileName}`,
      "",
      `Extracted with ${result.backend}.`,
      "",
      truncateText(text),
    ].join("\n");
  } catch {
    return null;
  }
}

export async function buildEphemeralAttachmentTextPreview(input: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
}): Promise<string | null> {
  const fileName = input.fileName || "attachment";
  const mimeType = input.mimeType?.trim() || "application/octet-stream";

  if (input.buffer.length > MAX_EPHEMERAL_ATTACHMENT_PREVIEW_BYTES) {
    return null;
  }

  if (WORKBOOK_MIMES.has(mimeType) || /\.(xlsx|xls|ods|csv|tsv)$/i.test(fileName)) {
    return previewWorkbook(input.buffer, fileName);
  }

  if (DOCX_MIMES.has(mimeType) || /\.docx$/i.test(fileName)) {
    return previewDocx(input.buffer, fileName);
  }

  if (TEXT_LIKE_MIMES.has(mimeType) || /\.(md|txt|csv|tsv|json|ya?ml|xml|html?|qmd)$/i.test(fileName)) {
    return previewText(input.buffer, fileName, mimeType);
  }

  if (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) {
    return previewUnstructured({
      buffer: input.buffer,
      fileName,
      fileType: "pdf",
    });
  }

  if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|tiff?)$/i.test(fileName)) {
    return previewUnstructured({
      buffer: input.buffer,
      fileName,
      fileType: "image",
    });
  }

  return null;
}
