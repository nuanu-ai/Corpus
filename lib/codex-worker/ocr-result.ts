function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeOcrResult(ocrResult: unknown): Record<string, unknown> | null {
  if (isRecord(ocrResult)) return ocrResult;
  if (typeof ocrResult !== "string") return null;

  const raw = ocrResult.trim();
  if (raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
