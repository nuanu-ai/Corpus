import { execFile } from "child_process";
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "fs/promises";
import { dirname, extname, join, relative, resolve } from "path";
import { promisify } from "util";

import * as XLSX from "xlsx";

import type { CodexArtifactManifest, CodexArtifactUnit } from "./types.ts";
import type { CodexSourceContext } from "./source-context.ts";

const execFileAsync = promisify(execFile);
const MAX_EXCEL_WORKBOOK_BYTES = 25 * 1024 * 1024;
const PDF_EXTRACTION_TIMEOUT_MS = 120_000;
const PDF_EXTRACTION_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

interface ArtifactizeInput {
  documentId: string;
  fileName: string;
  fileType: string;
  buffer: Buffer;
  workspaceDir: string;
  sourceContext?: CodexSourceContext | null;
}

interface PdfPageExtraction {
  page_number: number;
  text: string;
  char_count: number;
  image_path?: string;
  image_width?: number;
  image_height?: number;
  image_reason?: string;
}

interface PdfExtractionResult {
  ok: boolean;
  pages?: PdfPageExtraction[];
  error?: string;
  render?: {
    requested: boolean;
    rendered: number;
    skipped: number;
    max_pages: number;
    sparse_threshold: number;
    dpi: number;
    error?: string;
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unit";
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function previewText(value: string, maxChars = 3000): string {
  const normalized = normalizeText(value).trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}

function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\n+/g, " ").trim();
  return String(value).replace(/\n+/g, " ").trim();
}

function csvEscape(value: unknown): string {
  const normalized = sanitizeCell(value);
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n");
}

function formatMarkdownTable(rows: unknown[][], maxRows = 30, maxCols = 10): string {
  const slicedRows = rows.slice(0, maxRows).map((row) => row.slice(0, maxCols));
  if (slicedRows.length === 0) {
    return "_No visible rows detected._";
  }

  const width = Math.max(...slicedRows.map((row) => row.length), 1);
  const normalizedRows = slicedRows.map((row) =>
    Array.from({ length: width }, (_, index) => sanitizeCell(row[index])),
  );

  const header = normalizedRows[0].map((cell, index) => cell || `Column ${index + 1}`);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];

  for (const row of normalizedRows.slice(1)) {
    lines.push(`| ${row.join(" | ")} |`);
  }

  if (rows.length > maxRows) {
    lines.push("");
    lines.push(`_Preview limited to ${maxRows} rows._`);
  }

  return lines.join("\n");
}

function ensureText(text: string, fallback: string): string {
  const normalized = normalizeText(text).trim();
  return normalized.length > 0 ? normalized : fallback;
}

function assertWithinSizeLimit(
  size: number,
  maxBytes: number,
  label: string,
): void {
  if (size > maxBytes) {
    throw new Error(`${label} exceeds the maximum supported size of ${maxBytes} bytes`);
  }
}

function deriveEffectiveSheetRange(
  sheet: XLSX.WorkSheet,
): { declaredRange: string | null; effectiveRange: string | null; trimmed: boolean } {
  const declaredRange = typeof sheet["!ref"] === "string" ? sheet["!ref"] : null;
  const cellAddresses = Object.keys(sheet).filter((key) => /^[A-Z]{1,3}[1-9][0-9]*$/.test(key));

  if (cellAddresses.length === 0) {
    return {
      declaredRange,
      effectiveRange: declaredRange,
      trimmed: false,
    };
  }

  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let maxCol = 0;

  for (const address of cellAddresses) {
    const cell = XLSX.utils.decode_cell(address);
    minRow = Math.min(minRow, cell.r);
    minCol = Math.min(minCol, cell.c);
    maxRow = Math.max(maxRow, cell.r);
    maxCol = Math.max(maxCol, cell.c);
  }

  const effectiveRange = XLSX.utils.encode_range({
    s: { r: minRow, c: minCol },
    e: { r: maxRow, c: maxCol },
  });

  return {
    declaredRange,
    effectiveRange,
    trimmed: declaredRange !== null && declaredRange !== effectiveRange,
  };
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, normalizeText(content), "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

function buildSheetUnit(
  ordinal: number,
  title: string,
  sourcePath: string,
  previewPath: string,
  metadataPath: string,
  metadata: Record<string, unknown>,
): CodexArtifactUnit {
  return {
    slug: `sheet-${String(ordinal).padStart(2, "0")}-${slugify(title)}`,
    ordinal,
    title,
    unitKind: "sheet",
    sourcePath,
    previewPath,
    metadataPath,
    metadata,
  };
}

function buildPageUnit(
  ordinal: number,
  sourcePath: string,
  previewPath: string,
  metadataPath: string,
  metadata: Record<string, unknown>,
  visualPath?: string,
): CodexArtifactUnit {
  return {
    slug: `page-${String(ordinal).padStart(3, "0")}`,
    ordinal,
    title: `Page ${ordinal}`,
    unitKind: "page",
    sourcePath,
    ...(visualPath ? { visualPath } : {}),
    previewPath,
    metadataPath,
    metadata,
  };
}

function buildFileUnit(
  slug: string,
  title: string,
  sourcePath: string,
  previewPath: string,
  metadataPath: string,
  metadata: Record<string, unknown>,
): CodexArtifactUnit {
  return {
    slug,
    ordinal: 1,
    title,
    unitKind: "file",
    sourcePath,
    previewPath,
    metadataPath,
    metadata,
  };
}

async function artifactizeExcel(
  workbookBuffer: Buffer,
  workspaceDir: string,
): Promise<{ notes: string[]; units: CodexArtifactUnit[] }> {
  assertWithinSizeLimit(
    workbookBuffer.byteLength,
    MAX_EXCEL_WORKBOOK_BYTES,
    "Excel workbook",
  );

  const workbook = XLSX.read(workbookBuffer, {
    type: "buffer",
    cellFormula: true,
    cellNF: true,
    cellDates: true,
  });
  const notes: string[] = [];
  const units: CodexArtifactUnit[] = [];

  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const { declaredRange, effectiveRange, trimmed } = deriveEffectiveSheetRange(sheet);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
      ...(effectiveRange ? { range: effectiveRange } : {}),
    });
    const ordinal = index + 1;
    const slug = `sheet-${String(ordinal).padStart(2, "0")}-${slugify(sheetName)}`;
    const csvRelPath = `artifacts/raw/${slug}.csv`;
    const previewRelPath = `artifacts/previews/${slug}.md`;
    const metadataRelPath = `artifacts/metadata/${slug}.json`;
    const csvPath = join(workspaceDir, csvRelPath);
    const previewPath = join(workspaceDir, previewRelPath);
    const metadataPath = join(workspaceDir, metadataRelPath);
    const usedRange = effectiveRange;
    const formulas = Object.values(sheet).filter((cell) =>
      typeof cell === "object" &&
      cell !== null &&
      "f" in cell &&
      typeof cell.f === "string",
    ).length;

    await writeText(csvPath, rowsToCsv(rows));
    await writeText(
      previewPath,
      `# ${sheetName}\n\n## Table Preview\n\n${formatMarkdownTable(rows)}\n`,
    );
    await writeJson(metadataPath, {
      sheet_name: sheetName,
      ordinal,
      used_range: usedRange,
      declared_range: declaredRange,
      range_trimmed: trimmed,
      row_count: rows.length,
      formula_cell_count: formulas,
    });

    if (trimmed && declaredRange && effectiveRange) {
      notes.push(
        `Sheet "${sheetName}" declared oversized used range ${declaredRange}; trimmed to populated range ${effectiveRange}.`,
      );
    }

    units.push(
      buildSheetUnit(ordinal, sheetName, csvRelPath, previewRelPath, metadataRelPath, {
        sheet_name: sheetName,
        used_range: usedRange,
        declared_range: declaredRange,
        range_trimmed: trimmed,
        row_count: rows.length,
        formula_cell_count: formulas,
      }),
    );
  }

  if (units.length === 0) {
    notes.push("Workbook contained no readable sheets.");
  }

  return { notes, units };
}

async function artifactizeDelimitedFile(
  fileBuffer: Buffer,
  fileName: string,
  workspaceDir: string,
): Promise<{ notes: string[]; units: CodexArtifactUnit[] }> {
  const rawText = normalizeText(fileBuffer.toString("utf8"));
  const previewRows = rawText
    .split("\n")
    .slice(0, 30)
    .map((line) => line.split(",").slice(0, 10));

  const slug = `file-${slugify(fileName)}`;
  const rawRelPath = `artifacts/raw/${slug}.csv`;
  const previewRelPath = `artifacts/previews/${slug}.md`;
  const metadataRelPath = `artifacts/metadata/${slug}.json`;

  await writeText(join(workspaceDir, rawRelPath), rawText);
  await writeText(
    join(workspaceDir, previewRelPath),
    `# ${fileName}\n\n## CSV Preview\n\n${formatMarkdownTable(previewRows)}\n`,
  );
  await writeJson(join(workspaceDir, metadataRelPath), {
    line_count: rawText.split("\n").length,
    character_count: rawText.length,
  });

  return {
    notes: [],
    units: [
      buildFileUnit(slug, fileName, rawRelPath, previewRelPath, metadataRelPath, {
        line_count: rawText.split("\n").length,
        character_count: rawText.length,
      }),
    ],
  };
}

async function artifactizeTextFile(
  fileBuffer: Buffer,
  fileName: string,
  workspaceDir: string,
): Promise<{ notes: string[]; units: CodexArtifactUnit[] }> {
  const text = ensureText(fileBuffer.toString("utf8"), "No text content extracted.");
  const slug = `file-${slugify(fileName)}`;
  const rawRelPath = `artifacts/raw/${slug}.txt`;
  const previewRelPath = `artifacts/previews/${slug}.md`;
  const metadataRelPath = `artifacts/metadata/${slug}.json`;

  await writeText(join(workspaceDir, rawRelPath), text);
  await writeText(
    join(workspaceDir, previewRelPath),
    `# ${fileName}\n\n## Text Preview\n\n\`\`\`text\n${previewText(text)}\n\`\`\`\n`,
  );
  await writeJson(join(workspaceDir, metadataRelPath), {
    line_count: text.split("\n").length,
    character_count: text.length,
  });

  return {
    notes: [],
    units: [
      buildFileUnit(slug, fileName, rawRelPath, previewRelPath, metadataRelPath, {
        line_count: text.split("\n").length,
        character_count: text.length,
      }),
    ],
  };
}

async function artifactizeDocx(
  fileBuffer: Buffer,
  fileName: string,
  workspaceDir: string,
): Promise<{ notes: string[]; units: CodexArtifactUnit[] }> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: fileBuffer });
  const text = ensureText(result.value, "No text content extracted from DOCX.");
  const { notes, units } = await artifactizeTextFile(
    Buffer.from(text, "utf8"),
    fileName,
    workspaceDir,
  );

  return {
    notes: result.messages.length
      ? [...notes, ...result.messages.map((message) => message.message)]
      : notes,
    units,
  };
}

function workspaceRelativePath(workspaceDir: string, path: string): string | null {
  const workspaceRoot = resolve(workspaceDir);
  const fullPath = resolve(path);
  if (fullPath !== workspaceRoot && !fullPath.startsWith(`${workspaceRoot}/`)) {
    return null;
  }
  return relative(workspaceRoot, fullPath).replace(/\\/g, "/");
}

async function runPdfExtraction(
  inputPath: string,
  imageDir: string,
): Promise<PdfExtractionResult> {
  const scriptPath = resolve(process.cwd(), "scripts", "codex_extract_pdf.py");
  try {
    await stat(scriptPath);
  } catch {
    return { ok: false, error: "PDF extraction helper is missing." };
  }

  try {
    const { stdout } = await execFileAsync(
      "python3",
      [
        scriptPath,
        inputPath,
        "--image-dir",
        imageDir,
      ],
      {
        timeout: PDF_EXTRACTION_TIMEOUT_MS,
        maxBuffer: PDF_EXTRACTION_MAX_BUFFER_BYTES,
      },
    );
    if (!stdout.trim()) {
      return { ok: false, error: "PDF extraction returned no output." };
    }
    return JSON.parse(stdout) as PdfExtractionResult;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function artifactizePdf(
  _fileBuffer: Buffer,
  fileName: string,
  workspaceDir: string,
  originalFilePath: string,
): Promise<{ notes: string[]; units: CodexArtifactUnit[] }> {
  const imageDir = join(workspaceDir, "artifacts", "images");
  const extraction = await runPdfExtraction(originalFilePath, imageDir);
  if (!extraction.ok || !extraction.pages || extraction.pages.length === 0) {
    const notes = [extraction.error ?? "PDF extraction failed; using file-level fallback."];
    const fallbackText = `PDF file: ${fileName}\n\nText extraction did not produce page-level content. Inspect the original file directly if needed.`;
    const { units } = await artifactizeTextFile(
      Buffer.from(fallbackText, "utf8"),
      fileName,
      workspaceDir,
    );
    return { notes, units };
  }

  const units: CodexArtifactUnit[] = [];
  const notes: string[] = [];
  if (extraction.render?.error) {
    notes.push(`PDF visual page rendering failed: ${extraction.render.error}`);
  } else if (extraction.render && extraction.render.rendered > 0) {
    notes.push(
      `Rendered ${extraction.render.rendered} sparse PDF page(s) as visual artifacts for Codex image analysis.`,
    );
    if (extraction.render.skipped > 0) {
      notes.push(
        `Skipped ${extraction.render.skipped} additional sparse PDF page(s) after render limit ${extraction.render.max_pages}.`,
      );
    }
  }

  for (const page of extraction.pages) {
    const slug = `page-${String(page.page_number).padStart(3, "0")}`;
    const rawRelPath = `artifacts/raw/${slug}.txt`;
    const previewRelPath = `artifacts/previews/${slug}.md`;
    const metadataRelPath = `artifacts/metadata/${slug}.json`;
    const pageText = ensureText(
      page.text,
      "No extractable text found on this page. The page may be scanned or image-based.",
    );
    const visualRelPath = page.image_path
      ? workspaceRelativePath(workspaceDir, page.image_path)
      : null;

    await writeText(join(workspaceDir, rawRelPath), pageText);
    await writeText(
      join(workspaceDir, previewRelPath),
      [
        `# Page ${page.page_number}`,
        "",
        ...(visualRelPath
          ? [
              "## Visual Render",
              "",
              `Rendered page image: \`${visualRelPath}\``,
              "",
            ]
          : []),
        "## Extracted Text Preview",
        "",
        "```text",
        previewText(pageText),
        "```",
        "",
      ].join("\n"),
    );
    await writeJson(join(workspaceDir, metadataRelPath), {
      page_number: page.page_number,
      char_count: page.char_count,
      visual_render_path: visualRelPath,
      image_width: page.image_width ?? null,
      image_height: page.image_height ?? null,
      image_reason: page.image_reason ?? null,
    });

    units.push(
      buildPageUnit(page.page_number, rawRelPath, previewRelPath, metadataRelPath, {
        page_number: page.page_number,
        char_count: page.char_count,
        visual_render_path: visualRelPath,
        image_width: page.image_width ?? null,
        image_height: page.image_height ?? null,
        image_reason: page.image_reason ?? null,
      }, visualRelPath ?? undefined),
    );
  }

  return { notes, units };
}

async function artifactizeGenericBinary(
  fileName: string,
  workspaceDir: string,
  originalFilePath: string,
): Promise<{ notes: string[]; units: CodexArtifactUnit[] }> {
  const rawRelPath = `artifacts/raw/file-${slugify(fileName)}.txt`;
  const previewRelPath = `artifacts/previews/file-${slugify(fileName)}.md`;
  const metadataRelPath = `artifacts/metadata/file-${slugify(fileName)}.json`;
  const instruction = [
    `Original file path: ${originalFilePath}`,
    "This file type did not have a specialized artifact adapter.",
    "Inspect the original file directly from the workspace.",
  ].join("\n");

  await writeText(join(workspaceDir, rawRelPath), instruction);
  await writeText(
    join(workspaceDir, previewRelPath),
    `# ${fileName}\n\n## Handling Note\n\n${instruction}\n`,
  );
  await writeJson(join(workspaceDir, metadataRelPath), {
    fallback: true,
    original_file_path: originalFilePath,
  });

  return {
    notes: ["No specialized artifact adapter was available for this file type."],
    units: [
      buildFileUnit(
        `file-${slugify(fileName)}`,
        fileName,
        rawRelPath,
        previewRelPath,
        metadataRelPath,
        {
          fallback: true,
          original_file_path: originalFilePath,
        },
      ),
    ],
  };
}

export async function artifactizeDocument(
  input: ArtifactizeInput,
): Promise<CodexArtifactManifest> {
  const inputDir = join(input.workspaceDir, "input");
  const rawDir = join(input.workspaceDir, "artifacts", "raw");
  const previewDir = join(input.workspaceDir, "artifacts", "previews");
  const metadataDir = join(input.workspaceDir, "artifacts", "metadata");
  const imageDir = join(input.workspaceDir, "artifacts", "images");
  await Promise.all([
    ensureDir(inputDir),
    ensureDir(rawDir),
    ensureDir(previewDir),
    ensureDir(metadataDir),
    ensureDir(imageDir),
  ]);

  const extension = extname(input.fileName).toLowerCase();
  const originalRelPath = `input/original${extension || ".bin"}`;
  const originalPath = join(input.workspaceDir, originalRelPath);
  await writeFile(originalPath, input.buffer);

  let notes: string[] = [];
  let units: CodexArtifactUnit[] = [];

  switch (input.fileType) {
    case "excel": {
      const result = await artifactizeExcel(input.buffer, input.workspaceDir);
      notes = result.notes;
      units = result.units;
      break;
    }
    case "csv": {
      const result = await artifactizeDelimitedFile(
        input.buffer,
        input.fileName,
        input.workspaceDir,
      );
      notes = result.notes;
      units = result.units;
      break;
    }
    case "knowledge": {
      if (extension === ".docx") {
        const result = await artifactizeDocx(
          input.buffer,
          input.fileName,
          input.workspaceDir,
        );
        notes = result.notes;
        units = result.units;
      } else {
        const result = await artifactizeTextFile(
          input.buffer,
          input.fileName,
          input.workspaceDir,
        );
        notes = result.notes;
        units = result.units;
      }
      break;
    }
    case "pdf": {
      const result = await artifactizePdf(
        input.buffer,
        input.fileName,
        input.workspaceDir,
        originalPath,
      );
      notes = result.notes;
      units = result.units;
      break;
    }
    case "ofx":
    case "qif": {
      const result = await artifactizeTextFile(
        input.buffer,
        input.fileName,
        input.workspaceDir,
      );
      notes = result.notes;
      units = result.units;
      break;
    }
    default: {
      const result = await artifactizeGenericBinary(
        input.fileName,
        input.workspaceDir,
        originalPath,
      );
      notes = result.notes;
      units = result.units;
      break;
    }
  }

  const manifest: CodexArtifactManifest = {
    version: 1,
    documentId: input.documentId,
    fileName: input.fileName,
    fileType: input.fileType,
    originalFilePath: originalRelPath,
    generatedAt: new Date().toISOString(),
    notes,
    units,
    sourceContext: input.sourceContext ?? undefined,
  };

  await writeJson(join(input.workspaceDir, "artifacts", "manifest.json"), manifest);
  return manifest;
}

export async function readWorkspaceTextFile(
  workspaceDir: string,
  relativePath: string,
): Promise<string> {
  const normalizedRelativePath = relativePath.trim();
  if (!normalizedRelativePath || normalizedRelativePath.startsWith("/")) {
    throw new Error("Workspace file path must be relative");
  }

  const workspaceRoot = resolve(workspaceDir);
  const fullPath = resolve(workspaceRoot, normalizedRelativePath);
  if (fullPath !== workspaceRoot && !fullPath.startsWith(`${workspaceRoot}/`)) {
    throw new Error("Workspace file path escapes the workspace root");
  }

  return readFile(fullPath, "utf8");
}
