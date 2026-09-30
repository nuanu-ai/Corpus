type ConnectorPayload = Record<string, unknown>;

function isRecord(value: unknown): value is ConnectorPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDateText(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;

  const explicitDayMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (explicitDayMatch) {
    return explicitDayMatch[0];
  }

  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function pickText(record: ConnectorPayload, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = toText(record[key]);
    if (value) return value;
  }
  return null;
}

function pickNumber(record: ConnectorPayload, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function getDocumentDate(record: ConnectorPayload): string | null {
  const document = isRecord(record.document) ? record.document : null;
  if (!document) return null;
  return pickText(document, ["documentDate", "date"]);
}

function getReconciliation(record: ConnectorPayload): ConnectorPayload | null {
  return isRecord(record.reconciliation) ? record.reconciliation : null;
}

function normalizeDateRangeRecord(record: ConnectorPayload): ConnectorPayload | null {
  const startDate =
    normalizeDateText(record.startDate) ??
    normalizeDateText(record.from) ??
    normalizeDateText(record.minDate) ??
    normalizeDateText(record.earliestDate) ??
    normalizeDateText(record.oldestDate);
  const endDate =
    normalizeDateText(record.endDate) ??
    normalizeDateText(record.to) ??
    normalizeDateText(record.maxDate) ??
    normalizeDateText(record.latestDate) ??
    normalizeDateText(record.newestDate);

  if (!startDate && !endDate) return null;

  const normalized: ConnectorPayload = {};
  if (startDate) normalized.startDate = startDate;
  if (endDate) normalized.endDate = endDate;
  return normalized;
}

function inferAvailableDateRange(payload: ConnectorPayload): ConnectorPayload | null {
  const explicitRanges = [
    payload.availableDateRange,
    payload.historyBoundary,
    payload.historyDateRange,
    payload.dataDateRange,
  ];

  for (const candidate of explicitRanges) {
    if (!isRecord(candidate)) continue;
    const normalized = normalizeDateRangeRecord(candidate);
    if (normalized) return normalized;
  }

  const scalarRange = normalizeDateRangeRecord(payload);
  if (
    scalarRange &&
    (payload.oldestDate !== undefined ||
      payload.earliestDate !== undefined ||
      payload.minDate !== undefined ||
      payload.newestDate !== undefined ||
      payload.latestDate !== undefined ||
      payload.maxDate !== undefined)
  ) {
    return scalarRange;
  }

  return null;
}

function inferSampleDateRange(sample: ConnectorPayload[]): ConnectorPayload | null {
  const dates = sample
    .map((item) => normalizeDateText(item.date))
    .filter((date): date is string => Boolean(date))
    .sort();

  if (dates.length === 0) return null;

  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
  };
}

function inferCollectionNameFromAction(action: string | null): string | null {
  if (!action) return null;
  if (action.startsWith("list_")) return action.slice(5);
  if (action.startsWith("get_")) return action.slice(4);
  return null;
}

function compactConnectorCollectionItem(value: unknown): ConnectorPayload | null {
  if (!isRecord(value)) return null;

  const reconciliation = getReconciliation(value);
  const category = isRecord(value.category) ? value.category : null;
  const supplier = isRecord(value.supplier) ? value.supplier : null;

  const compact: ConnectorPayload = {};
  for (const [key, next] of [
    ["id", pickText(value, ["id"])],
    ["title", pickText(value, ["title", "displayName", "name", "description"])],
    ["status", pickText(value, ["status"])],
    ["email", pickText(value, ["email"])],
    ["documentNumber", pickText(isRecord(value.document) ? value.document : {}, ["documentNumber"])],
    ["date", getDocumentDate(value) ?? pickText(value, ["postingDate", "date", "createdAt", "settledAt"])],
    ["currency", reconciliation ? pickText(reconciliation, ["currency", "baseCurrency"]) : pickText(value, ["currency"])],
    ["amount", reconciliation ? pickNumber(reconciliation, ["totalAmount", "baseTotalAmount"]) : pickNumber(value, ["amount", "totalAmount", "balance"])],
    ["category", category ? pickText(category, ["name"]) : null],
    ["supplier", supplier ? pickText(supplier, ["name"]) : null],
  ] as const) {
    if (next !== null && next !== undefined) {
      compact[key] = next;
    }
  }

  return Object.keys(compact).length > 0 ? compact : null;
}

function getPreferredCollectionKeys(payload: ConnectorPayload): string[] {
  const preferred = [
    "expenses",
    "fundAccounts",
    "generalLedgerEntries",
    "salesInvoices",
    "purchaseInvoices",
    "vendorPayments",
    "customerPayments",
    "vendors",
    "customers",
    "journals",
    "journalLines",
    "tickets",
    "messages",
    "files",
    "items",
  ];

  const keys = Object.keys(payload).filter((key) => {
    const value = payload[key];
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.some((item) => isRecord(item));
  });
  return [
    ...preferred.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !preferred.includes(key)),
  ];
}

export function summarizeConnectorPayload(payload: unknown): ConnectorPayload | null {
  if (!isRecord(payload)) return null;

  const summary: ConnectorPayload = {};
  for (const key of [
    "provider",
    "action",
    "error",
    "message",
    "count",
    "returnedCount",
    "matchingCount",
    "totalCount",
    "top",
    "skip",
    "offset",
    "hasMore",
    "nextOffset",
    "nextSkip",
    "nextLink",
    "limit",
  ] as const) {
    if (payload[key] !== undefined) {
      summary[key] = payload[key];
    }
  }

  if (Array.isArray(payload.supportedActions)) {
    summary.supportedActions = payload.supportedActions.slice(0, 8);
  }

  if (isRecord(payload.dateRangeApplied)) {
    const dateRangeApplied = payload.dateRangeApplied;
    summary.dateRangeApplied = {
      mode: toText(dateRangeApplied.mode),
      startDate: normalizeDateText(dateRangeApplied.startDate),
      endDate: normalizeDateText(dateRangeApplied.endDate),
      scanIncomplete: dateRangeApplied.scanIncomplete === true,
    };
  }

  const availableDateRange = inferAvailableDateRange(payload);
  if (availableDateRange) {
    summary.availableDateRange = availableDateRange;
    summary.historyBoundaryKnown = true;
  }

  for (const key of getPreferredCollectionKeys(payload)) {
    const collection = payload[key];
    if (!Array.isArray(collection) || collection.length === 0) continue;
    const sample = collection
      .slice(0, 3)
      .map((item) => compactConnectorCollectionItem(item))
      .filter((item): item is ConnectorPayload => Boolean(item));
    summary.collection = key;
    if (sample.length > 0) {
      summary.sample = sample;
      const sampleDateRange = inferSampleDateRange(sample);
      if (sampleDateRange && !availableDateRange) {
        summary.sampleDateRange = sampleDateRange;
        summary.historyBoundaryKnown = false;
        summary.historyBoundaryNote =
          "Sample rows are illustrative only and do not define the connector's full history.";
      }
    }
    break;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

export function buildConnectorResultSummary(
  provider: string,
  requestedAction: string,
  payload: unknown,
  status?: number | null,
): string | null {
  const summary = summarizeConnectorPayload(payload);
  if (!summary) {
    return status && status >= 400
      ? `${provider}.${requestedAction} failed with status ${status}.`
      : null;
  }

  const resolvedAction =
    toText(summary.action) ?? requestedAction;
  const error = toText(summary.error) ?? toText(summary.message);
  if (error) {
    return `${provider}.${resolvedAction} failed: ${error}`;
  }

  const count =
    toNumber(summary.returnedCount) ??
    toNumber(summary.matchingCount) ??
    toNumber(summary.count) ??
    toNumber(summary.totalCount);

  const collection = toText(summary.collection);
  const range = isRecord(summary.dateRangeApplied) ? summary.dateRangeApplied : null;
  const startDate = range ? toText(range.startDate) : null;
  const endDate = range ? toText(range.endDate) : null;
  const availableDateRange = isRecord(summary.availableDateRange)
    ? summary.availableDateRange
    : null;
  const availableStartDate = availableDateRange ? toText(availableDateRange.startDate) : null;
  const availableEndDate = availableDateRange ? toText(availableDateRange.endDate) : null;
  const sampleDateRange = isRecord(summary.sampleDateRange) ? summary.sampleDateRange : null;
  const sampleStartDate = sampleDateRange ? toText(sampleDateRange.startDate) : null;
  const sampleEndDate = sampleDateRange ? toText(sampleDateRange.endDate) : null;
  const historyBoundaryKnown =
    typeof summary.historyBoundaryKnown === "boolean" ? summary.historyBoundaryKnown : null;

  if (count !== null) {
    const noun = collection ?? inferCollectionNameFromAction(resolvedAction) ?? resolvedAction;
    if (startDate && endDate) {
      return `Returned ${count} ${noun} for ${startDate} to ${endDate}.`;
    }

    let summaryText = `Returned ${count} ${noun}.`;
    if (availableStartDate || availableEndDate) {
      summaryText += ` Available connector history spans ${availableStartDate ?? "unknown"} to ${availableEndDate ?? "unknown"}.`;
    } else if (
      historyBoundaryKnown === false &&
      (sampleStartDate || sampleEndDate)
    ) {
      summaryText += ` Sample rows include dates from ${sampleStartDate ?? "unknown"} to ${sampleEndDate ?? "unknown"}; this sample does not define the connector's full history.`;
    }
    return summaryText;
  }

  return `${provider}.${resolvedAction} completed.`;
}
