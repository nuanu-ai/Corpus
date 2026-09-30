import { execFile } from "child_process";
import { access, mkdtemp, rm, writeFile } from "fs/promises";
import { join, extname } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

import type { ParseResult } from "./format-router";
import type { ParseDocumentSourceContext } from "./format-router";
import type { ExtractedReport, ReportLineItem } from "./report-types";
import {
  parsePeriodFromFileName,
  parsePeriodFromSourcePath,
} from "./period-utils";
import {
  buildPythonBridgeExecOptions,
  readBoundedIntEnv,
} from "./subprocess-timeout";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// REL-1: Concurrency semaphore — env-tunable, no external dependency
// ---------------------------------------------------------------------------

const MAX_CONCURRENCY = readBoundedIntEnv(
  "UNSTRUCTURED_FINANCIAL_MAX_CONCURRENCY",
  3,
  1,
  16,
);

/** Inline promise-queue semaphore (acquired before spawn, released in finally). */
class Semaphore {
  private _queue: Array<() => void> = [];
  private _running = 0;
  constructor(private readonly _limit: number) {}

  acquire(): Promise<void> {
    if (this._running < this._limit) {
      this._running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._running--;
    }
  }
}

const bridgeSemaphore = new Semaphore(MAX_CONCURRENCY);

// ---------------------------------------------------------------------------
// REL-1: Max input bytes guard
// ---------------------------------------------------------------------------

const MAX_INPUT_BYTES = readBoundedIntEnv(
  "UNSTRUCTURED_FINANCIAL_MAX_INPUT_BYTES",
  50 * 1024 * 1024, // 50 MB default
  1024,
  500 * 1024 * 1024, // hard cap 500 MB
);

export class InputTooLargeError extends Error {
  constructor(public readonly sizeBytes: number, public readonly limitBytes: number) {
    super(
      `Document too large for extraction: ${sizeBytes} bytes exceeds limit of ${limitBytes} bytes`,
    );
    this.name = "InputTooLargeError";
  }
}

const BRIDGE_SCRIPT_PATH = join(
  process.cwd(),
  "extraction",
  "src",
  "extraction",
  "unstructured_bridge.py",
);

const REPORT_HINT_PATTERNS = [
  /\bp&l\b/i,
  /\bpnl\b/i,
  /profit\s*&?\s*loss/i,
  /income\s+statement/i,
  /balance\s+sheet/i,
  /trial\s+balance/i,
  /general\s+ledger/i,
  /statement\s+of\s+financial\s+position/i,
  /financial\s+statement/i,
];

const NUMERIC_LINE_RE =
  /^([A-Za-z][A-Za-z0-9&/(),.'"\-+\s]{2,}?)\s{2,}(\(?-?\d[\d,\s.]*\)?)$/;

interface BridgeSuccess {
  ok: true;
  backend: "unstructured" | "pdfplumber";
  text: string;
  metadata?: Record<string, unknown>;
}

interface BridgeFailure {
  ok: false;
  error: string;
}

type BridgeResult = BridgeSuccess | BridgeFailure;

/** Structured failure returned when the bridge process itself couldn't run or crashed. */
export interface BridgeSpawnFailure {
  spawnFailed: true;
  reason: string;
}

function shouldUseUnstructuredFallback(): boolean {
  return process.env.UNSTRUCTURED_FINANCIAL_ENABLED !== "false";
}

function confidenceThreshold(): number {
  const parsed = Number(
    process.env.UNSTRUCTURED_FINANCIAL_CONFIDENCE_THRESHOLD ?? "0.7",
  );
  if (!Number.isFinite(parsed)) return 0.7;
  return Math.min(1, Math.max(0, parsed));
}

function hasReportHint(text: string): boolean {
  return REPORT_HINT_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeAmount(raw: string): number | null {
  let cleaned = raw.replace(/\s+/g, "").replace(/,/g, "");
  let negative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

function inferSection(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("asset")) return "assets";
  if (normalized.includes("liabilit")) return "liabilities";
  if (normalized.includes("equity")) return "equity";
  if (normalized.includes("revenue") || normalized.includes("income"))
    return "revenue";
  if (normalized.includes("expense") || normalized.includes("cost"))
    return "expenses";
  return "statement";
}

function extractLineItems(text: string, maxItems = 200): ReportLineItem[] {
  const lineItems: ReportLineItem[] = [];
  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (lineItems.length >= maxItems) break;
    const line = lines[idx]?.trim();
    if (!line) continue;
    const match = line.match(NUMERIC_LINE_RE);
    if (!match) continue;

    const accountName = match[1].trim();
    const amount = normalizeAmount(match[2].trim());
    if (amount === null) continue;

    lineItems.push({
      account_name: accountName,
      section: inferSection(accountName),
      values: { amount },
      depth: 0,
      is_total: /\btotal\b/i.test(accountName),
      source: {
        sheet: "pdf",
        row: idx + 1,
        columns: { amount: "A" },
      },
    });
  }
  return lineItems;
}

export function looksLikeFinancialReport(text: string, fileName: string): boolean {
  if (hasReportHint(fileName)) return true;
  return hasReportHint(text);
}

function toUnknownPeriod() {
  return {
    start: "1970-01-01",
    end: "1970-01-01",
    label: "Unknown",
  };
}

function calculateConfidence(input: {
  text: string;
  fileName: string;
  lineItems: ReportLineItem[];
  hasKnownPeriod: boolean;
}): number {
  let score = 0.35;
  if (looksLikeFinancialReport(input.text, input.fileName)) {
    score += 0.25;
  }
  if (input.text.length > 2000) {
    score += 0.2;
  } else if (input.text.length > 600) {
    score += 0.1;
  }

  if (input.lineItems.length >= 12) {
    score += 0.2;
  } else if (input.lineItems.length >= 4) {
    score += 0.1;
  }

  if (input.hasKnownPeriod) {
    score += 0.1;
  }

  return Math.max(0.3, Math.min(0.95, Number(score.toFixed(2))));
}

export function buildUnstructuredFinancialResult(args: {
  text: string;
  fileName: string;
  backend: string;
  bridgeMetadata?: Record<string, unknown>;
  sourceContext?: ParseDocumentSourceContext;
}): ParseResult {
  const period =
    parsePeriodFromFileName(args.fileName) ??
    parsePeriodFromSourcePath(args.sourceContext?.sourcePath ?? "") ??
    toUnknownPeriod();
  const lineItems = extractLineItems(args.text);
  const confidence = calculateConfidence({
    text: args.text,
    fileName: args.fileName,
    lineItems,
    hasKnownPeriod: period.label !== "Unknown",
  });
  const needsReview = confidence < confidenceThreshold();

  const report: ExtractedReport = {
    report_type: "financial_statement",
    reporting_period: period,
    currency: "USD",
    book: "actual",
    entity: "Unknown",
    sheet_name: "pdf",
    line_items: lineItems,
    confidence,
  };

  return {
    transactions: [],
    confidence,
    reports: [report],
    documentType: "financial_statement",
    needsReview,
    metadata: {
      provider: "unstructured-fallback",
      backend: args.backend,
      extractedChars: args.text.length,
      lineItemCount: lineItems.length,
      ...(args.bridgeMetadata ?? {}),
    },
  };
}

async function ensureBridgeScriptExists(): Promise<boolean> {
  try {
    await access(BRIDGE_SCRIPT_PATH);
    return true;
  } catch {
    return false;
  }
}

function resolveTempExtension(fileType: string, fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (ext) return ext;
  if (fileType === "pdf") return ".pdf";
  if (fileType === "image") return ".png";
  return ".bin";
}

async function runBridge(
  tempPath: string,
  fileType: string,
): Promise<BridgeResult | BridgeSpawnFailure | null> {
  if (!(await ensureBridgeScriptExists())) {
    return null;
  }

  // REL-1: acquire semaphore slot before spawning python3
  await bridgeSemaphore.acquire();
  try {
    const { stdout } = await execFileAsync(
      "python3",
      [BRIDGE_SCRIPT_PATH, "--input", tempPath, "--file-type", fileType],
      buildPythonBridgeExecOptions(
        "UNSTRUCTURED_FINANCIAL_BRIDGE_TIMEOUT_MS",
        90_000,
      ),
    );

    const stdoutText = String(stdout ?? "");
    if (!stdoutText.trim()) return null;
    const parsed = JSON.parse(stdoutText) as BridgeResult;
    return parsed;
  } catch (err: unknown) {
    // REL-5: log and surface structured failure reason instead of silently returning null
    const errObj = err as Record<string, unknown>;
    const killed = errObj["killed"] === true;
    const exitCode = errObj["code"] ?? errObj["exitCode"];
    const stderr = typeof errObj["stderr"] === "string" ? errObj["stderr"].slice(0, 512) : "";
    const message = err instanceof Error ? err.message : String(err);

    let reason: string;
    if (killed) {
      reason = `bridge_killed (timeout or SIGKILL); exit=${String(exitCode ?? "?")}`;
    } else if (exitCode !== undefined && exitCode !== null) {
      reason = `bridge_exit_nonzero; exit=${String(exitCode)}; msg=${message}`;
    } else {
      reason = `bridge_spawn_error; msg=${message}`;
    }
    if (stderr) {
      reason += `; stderr=${stderr}`;
    }

    console.error("[unstructured-financial] Bridge process failed:", {
      killed,
      exitCode,
      stderr,
      message,
    });

    return { spawnFailed: true, reason };
  } finally {
    // REL-1: always release semaphore slot
    bridgeSemaphore.release();
  }
}

export async function parseUnstructuredFinancialReport(
  buffer: Buffer,
  fileType: string,
  fileName: string,
  options?: {
    companyId?: string | undefined;
    sourceContext?: ParseDocumentSourceContext;
  },
): Promise<ParseResult | null> {
  if (fileType !== "pdf") return null;
  if (!options?.companyId) return null;
  if (!shouldUseUnstructuredFallback()) return null;

  // REL-1: max input bytes guard — throw BEFORE writeFile/spawn to avoid OOM
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new InputTooLargeError(buffer.length, MAX_INPUT_BYTES);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "unstructured-financial-"));
  const tempPath = join(tempDir, `input${resolveTempExtension(fileType, fileName)}`);

  try {
    await writeFile(tempPath, buffer);
    const bridge = await runBridge(tempPath, fileType);

    // REL-5: if the bridge itself failed (timeout/SIGKILL/non-zero exit), the
    // failure reason was already logged in runBridge(). We MUST still return
    // null here so the caller's fallback chain (e.g. Mindee OCR) can take over.
    // Returning a {transactions: []} object would short-circuit that fallback
    // and silently degrade ingestion, breaking the fallback contract.
    if (bridge && "spawnFailed" in bridge) {
      return null;
    }

    if (!bridge || !bridge.ok) return null;
    const text = bridge.text?.trim();
    if (!text) return null;
    if (!looksLikeFinancialReport(text, fileName)) {
      return null;
    }

    return buildUnstructuredFinancialResult({
      text,
      fileName,
      backend: bridge.backend,
      bridgeMetadata: bridge.metadata,
      sourceContext: options?.sourceContext,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
