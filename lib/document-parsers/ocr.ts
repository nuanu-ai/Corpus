import type { ParseResult, ParsedTransaction } from "./format-router";
import { readBoundedIntEnv } from "./subprocess-timeout";

const DEFAULT_OCR_PROVIDER_TIMEOUT_MS = 45_000;

function ocrProviderTimeoutMs(provider: "Mindee" | "Veryfi"): number {
  return readBoundedIntEnv(
    `${provider.toUpperCase()}_OCR_TIMEOUT_MS`,
    readBoundedIntEnv(
      "OCR_PROVIDER_TIMEOUT_MS",
      DEFAULT_OCR_PROVIDER_TIMEOUT_MS,
      5_000,
      120_000,
    ),
    5_000,
    120_000,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

async function fetchWithProviderTimeout(
  provider: "Mindee" | "Veryfi",
  url: string,
  init: RequestInit,
): Promise<Response> {
  const timeoutMs = ocrProviderTimeoutMs(provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${provider} API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Mindee Bank Statement API (direct HTTP)
// ---------------------------------------------------------------------------

interface MindeeTransaction {
  date?: string;
  amount?: number;
  description?: string;
  reference?: string;
}

interface MindeeResponse {
  api_request?: { status_code?: number };
  document?: {
    inference?: {
      prediction?: {
        transactions?: MindeeTransaction[];
        client?: { currency?: string };
      };
      pages?: Array<{
        prediction?: {
          transactions?: MindeeTransaction[];
        };
      }>;
    };
  };
}

async function callMindeeApi(
  buffer: Buffer,
  mimeType: string,
): Promise<MindeeResponse> {
  const apiKey = process.env.MINDEE_API_KEY;
  if (!apiKey) throw new Error("MINDEE_API_KEY is not configured");

  const formData = new FormData();
  formData.append(
    "document",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    "document",
  );

  const response = await fetchWithProviderTimeout(
    "Mindee",
    "https://api.mindee.net/v1/products/mindee/bank_statement/v2/predict",
    {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}` },
      body: formData,
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Mindee API error ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  return response.json() as Promise<MindeeResponse>;
}

function parseMindeeDate(raw: string | undefined): Date | null {
  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const [, year, month, day] = match;
  const d = new Date(
    Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)),
  );
  return isNaN(d.getTime()) ? null : d;
}

export async function parseBankStatement(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  const data = await callMindeeApi(fileBuffer, mimeType);

  const prediction = data.document?.inference?.prediction;
  const rawTransactions = prediction?.transactions ?? [];
  const rawCurrency = prediction?.client?.currency;
  const currency =
    typeof rawCurrency === "string" && rawCurrency.trim()
      ? rawCurrency.trim().toUpperCase()
      : null;

  const transactions: ParsedTransaction[] = [];

  for (const txn of rawTransactions) {
    const date = parseMindeeDate(txn.date);
    if (!date) continue;

    const amount = txn.amount;
    if (amount == null || isNaN(amount)) continue;

    transactions.push({
      date,
      amount,
      currency,
      description: txn.description ?? null,
      merchantName: null,
      sourceRef: txn.reference ?? null,
    });
  }

  return {
    transactions,
    confidence: 0.75,
    metadata: {
      provider: "mindee",
      rawTransactionCount: rawTransactions.length,
      parsedCount: transactions.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Veryfi Receipt API (direct HTTP)
// ---------------------------------------------------------------------------

interface VeryfiResponse {
  date?: string;
  total?: number;
  vendor?: { name?: string };
  currency_code?: string;
  reference_number?: string;
  line_items?: Array<{
    description?: string;
    total?: number;
  }>;
}

async function callVeryfiApi(
  buffer: Buffer,
  mimeType: string,
): Promise<VeryfiResponse> {
  const clientId = process.env.VERYFI_CLIENT_ID;
  const apiKey = process.env.VERYFI_API_KEY;
  if (!clientId || !apiKey)
    throw new Error("Veryfi credentials not configured");

  const base64 = buffer.toString("base64");

  // Derive a file extension from the MIME type for Veryfi
  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/tiff": "tiff",
    "application/pdf": "pdf",
  };
  const ext = extMap[mimeType] ?? "jpg";

  const response = await fetchWithProviderTimeout(
    "Veryfi",
    "https://api.veryfi.com/api/v8/partner/documents",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CLIENT-ID": clientId,
        AUTHORIZATION: `apikey ${apiKey}`,
      },
      body: JSON.stringify({
        file_data: base64,
        file_name: `document.${ext}`,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Veryfi API error ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  return response.json() as Promise<VeryfiResponse>;
}

function parseVeryfiDate(raw: string | undefined): Date | null {
  if (!raw) return null;

  // Veryfi returns dates in "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD" format
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const [, year, month, day] = match;
  const d = new Date(
    Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)),
  );
  return isNaN(d.getTime()) ? null : d;
}

export async function parseReceipt(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  const data = await callVeryfiApi(fileBuffer, mimeType);

  const date = parseVeryfiDate(data.date);
  const total = data.total;
  const vendorName = data.vendor?.name ?? null;
  const currency =
    typeof data.currency_code === "string" && data.currency_code.trim()
      ? data.currency_code.trim().toUpperCase()
      : null;
  const reference = data.reference_number ?? null;

  const transactions: ParsedTransaction[] = [];

  if (date && total != null && !isNaN(total)) {
    // Receipts are expenses (negative amounts)
    transactions.push({
      date,
      amount: -Math.abs(total),
      currency,
      description: vendorName ? `Receipt: ${vendorName}` : "Receipt",
      merchantName: vendorName,
      sourceRef: reference,
    });
  }

  return {
    transactions,
    confidence: 0.8,
    metadata: {
      provider: "veryfi",
      vendor: vendorName,
      total,
      lineItemCount: data.line_items?.length ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Main OCR entry point
// ---------------------------------------------------------------------------

function detectImageMime(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  return "image/jpeg"; // default fallback
}

// Phase 1 limitation: PDFs → bank statements, images → receipts.
// Future: add document-type classifier or accept explicit documentKind param.
export async function parseOcrDocument(
  buffer: Buffer,
  fileType: string,
): Promise<ParseResult> {
  const mimeType =
    fileType === "pdf" ? "application/pdf" : detectImageMime(buffer);

  switch (fileType) {
    case "pdf":
      return parseBankStatement(buffer, mimeType);

    case "image":
      return parseReceipt(buffer, mimeType);

    default:
      throw new Error(`Unsupported OCR file type: "${fileType}"`);
  }
}
