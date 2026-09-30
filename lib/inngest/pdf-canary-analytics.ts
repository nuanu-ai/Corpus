import { summarizeIngressDispatchState } from "@/lib/inngest/ingress-dispatch-state";

export interface CountedLabel {
  label: string;
  count: number;
}

export interface CountedLabelRow {
  label: string | null;
  count: number | string | null;
}

export interface PdfCanaryAnalyticsRecord {
  status: string;
  error: string | null;
  ocrResult: unknown;
}

export interface PdfDispatchFailureRecord {
  error: string | null;
}

export interface PdfCanaryAnalyticsSummary {
  observed: number;
  simplified: number;
  escalated: number;
  failed: number;
  topEscalationReasons: CountedLabel[];
  topFailureErrors: CountedLabel[];
}

function uniqueNormalizedLabels(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeLabel(value)).filter((value): value is string => Boolean(value)))];
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function buildTopCounts(values: Array<string | null | undefined>, limit = 5): CountedLabel[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = normalizeLabel(value);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function normalizeCount(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function coerceCountedLabels(rows: CountedLabelRow[], limit = 5): CountedLabel[] {
  return rows
    .map((row) => ({
      label: normalizeLabel(row.label),
      count: normalizeCount(row.count),
    }))
    .filter(
      (row): row is CountedLabel => row.label !== null && row.count !== null && row.count > 0,
    )
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}

export function summarizePdfCanaryAnalytics(
  records: PdfCanaryAnalyticsRecord[],
  limit = 5,
): PdfCanaryAnalyticsSummary {
  let observed = 0;
  let simplified = 0;
  let escalated = 0;
  let failed = 0;
  const escalationReasons: string[] = [];
  const failureErrors: Array<string | null | undefined> = [];

  for (const record of records) {
    const ingressDispatch = summarizeIngressDispatchState(record.ocrResult);
    if (!ingressDispatch) continue;

    observed += 1;

    if (ingressDispatch.processingStrategy === "simplified_narrative") {
      simplified += 1;
    }

    if (ingressDispatch.dispatchTarget === "codex_worker") {
      escalated += 1;
      escalationReasons.push(...uniqueNormalizedLabels(ingressDispatch.reasons));
    }

    if (record.status === "failed" || ingressDispatch.stage === "failed") {
      failed += 1;
      const preferredError = normalizeLabel(ingressDispatch.error) ?? normalizeLabel(record.error);
      if (preferredError) {
        failureErrors.push(preferredError);
      }
    }
  }

  return {
    observed,
    simplified,
    escalated,
    failed,
    topEscalationReasons: buildTopCounts(escalationReasons, limit),
    topFailureErrors: buildTopCounts(failureErrors, limit),
  };
}

export function summarizePdfDispatchFailureErrors(
  records: PdfDispatchFailureRecord[],
  limit = 5,
): CountedLabel[] {
  return buildTopCounts(
    records.map((record) => record.error),
    limit,
  );
}
