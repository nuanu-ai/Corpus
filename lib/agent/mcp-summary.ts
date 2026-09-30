const MAX_SUMMARY_CHARS = 2_600;
const MAX_FILE_PREVIEW_CHARS = 1_800;
const MAX_LIST_ITEMS = 5;
const MAX_VALUE_CHARS = 220;

function truncate(text: string, maxChars: number = MAX_SUMMARY_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeScalar(value: unknown, maxChars: number = MAX_VALUE_CHARS): string {
  return truncate(stringifyValue(value).replace(/\s+/g, " ").trim(), maxChars);
}

function summarizeArrayItems(
  items: unknown[],
  formatter: (item: unknown, index: number) => string | null,
): string[] {
  const lines: string[] = [];
  for (const [index, item] of items.slice(0, MAX_LIST_ITEMS).entries()) {
    const line = formatter(item, index);
    if (line) lines.push(line);
  }
  if (items.length > MAX_LIST_ITEMS) {
    lines.push(`- ${items.length - MAX_LIST_ITEMS} more item(s) not shown`);
  }
  return lines;
}

function summarizeResultItem(item: unknown, index: number): string | null {
  if (!item || typeof item !== "object") {
    return `- ${index + 1}. ${summarizeScalar(item)}`;
  }

  const record = item as Record<string, unknown>;
  const title =
    record.title ??
    record.name ??
    record.filePath ??
    record.file_path ??
    record.id ??
    `item-${index + 1}`;
  const qualifiers = [
    record.domain,
    record.type,
    record.status,
    record.filePath ?? record.file_path,
  ]
    .filter((value) => value !== undefined && value !== null && `${value}`.trim().length > 0)
    .map((value) => summarizeScalar(value, 80));

  const summary = record.managerialSummary ?? record.summary ?? record.description;
  const tail = summary ? ` — ${summarizeScalar(summary, 140)}` : "";
  return `- ${summarizeScalar(title, 120)}${qualifiers.length > 0 ? ` (${qualifiers.join(" | ")})` : ""}${tail}`;
}

function summarizeResultsPayload(payload: Record<string, unknown>): string {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const count =
    typeof payload.count === "number"
      ? payload.count
      : typeof payload.returnedCount === "number"
        ? payload.returnedCount
        : results.length;

  const lines = [
    `Returned ${results.length} result(s)${typeof count === "number" ? ` of ${count}` : ""}.`,
  ];

  if (payload.query) {
    lines.push(`Query: ${summarizeScalar(payload.query, 120)}`);
  }
  if (payload.domain) {
    lines.push(`Domain: ${summarizeScalar(payload.domain, 60)}`);
  }

  lines.push(...summarizeArrayItems(results, summarizeResultItem));
  return truncate(lines.join("\n"));
}

function looksLikeEntityList(items: unknown[]): boolean {
  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record.domain === "string" ||
      typeof record.type === "string" ||
      typeof record.filePath === "string" ||
      typeof record.file_path === "string" ||
      typeof record.qualifiedId === "string" ||
      typeof record.qualified_id === "string"
    );
  });
}

function summarizeDocumentsPayload(payload: Record<string, unknown>): string {
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const total =
    typeof payload.total === "number" ? payload.total : documents.length;
  const lines = [`Returned ${documents.length} document(s) of ${total}.`];
  lines.push(
    ...summarizeArrayItems(documents, (item, index) => {
      if (!item || typeof item !== "object") {
        return `- ${index + 1}. ${summarizeScalar(item)}`;
      }
      const record = item as Record<string, unknown>;
      const name = record.fileName ?? record.id ?? `document-${index + 1}`;
      const details = [
        record.status,
        record.documentType,
        record.reportingPeriod,
      ]
        .filter((value) => value !== undefined && value !== null && `${value}`.trim().length > 0)
        .map((value) => summarizeScalar(value, 60));
      return `- ${summarizeScalar(name, 120)}${details.length > 0 ? ` (${details.join(" | ")})` : ""}`;
    }),
  );
  return truncate(lines.join("\n"));
}

function summarizePeoplePayload(payload: Record<string, unknown>): string {
  const people = Array.isArray(payload.data) ? payload.data : [];
  const count = typeof payload.count === "number" ? payload.count : people.length;
  const lines = [`Returned ${people.length} people record(s) of ${count}.`];
  lines.push(
    ...summarizeArrayItems(people, (item, index) => {
      if (!item || typeof item !== "object") {
        return `- ${index + 1}. ${summarizeScalar(item)}`;
      }
      const record = item as Record<string, unknown>;
      const name = record.displayName ?? record.name ?? record.filePath ?? `person-${index + 1}`;
      const details = [
        record.role,
        record.organization,
        record.crmStatus,
      ]
        .filter((value) => value !== undefined && value !== null && `${value}`.trim().length > 0)
        .map((value) => summarizeScalar(value, 60));
      return `- ${summarizeScalar(name, 120)}${details.length > 0 ? ` (${details.join(" | ")})` : ""}`;
    }),
  );
  return truncate(lines.join("\n"));
}

function summarizeConnectorsPayload(payload: Record<string, unknown>): string {
  const connectors = Array.isArray(payload.connectors) ? payload.connectors : [];
  const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
  const catalogByProvider = new Map<string, Record<string, unknown>>();
  for (const entry of catalog) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.provider !== "string" || record.provider.trim().length === 0) continue;
    catalogByProvider.set(record.provider, record);
  }
  const lines = [`${connectors.length} connector(s) available.`];
  lines.push(
    ...summarizeArrayItems(connectors, (item, index) => {
      if (!item || typeof item !== "object") {
        return `- ${index + 1}. ${summarizeScalar(item)}`;
      }
      const record = item as Record<string, unknown>;
      const title = record.provider ?? record.id ?? `connector-${index + 1}`;
      const catalogEntry =
        typeof title === "string" ? catalogByProvider.get(title) : null;
      const details = [record.status, record.lastSyncAt, record.lastError]
        .filter((value) => value !== undefined && value !== null && `${value}`.trim().length > 0)
        .map((value) => summarizeScalar(value, 100));
      if (catalogEntry && Array.isArray(catalogEntry.actions)) {
        const actionPreview = catalogEntry.actions
          .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
          .map((value) => value.name)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .slice(0, 4);
        if (actionPreview.length > 0) {
          details.push(`actions: ${actionPreview.join(", ")}`);
        }
      }
      return `- ${summarizeScalar(title, 80)}${details.length > 0 ? ` (${details.join(" | ")})` : ""}`;
    }),
  );

  const catalogCount = Array.isArray(payload.catalog) ? payload.catalog.length : 0;
  const hubCatalogCount = Array.isArray(payload.hubCatalog) ? payload.hubCatalog.length : 0;
  if (catalogCount > 0 || hubCatalogCount > 0) {
    lines.push(`Catalogs available separately: connector=${catalogCount}, hub=${hubCatalogCount}.`);
  }
  return truncate(lines.join("\n"));
}

function summarizeDashboardPayload(payload: Record<string, unknown>): string {
  const dashboard =
    payload.dashboard && typeof payload.dashboard === "object"
      ? (payload.dashboard as Record<string, unknown>)
      : null;
  if (!dashboard) {
    return truncate(summarizeScalar(payload));
  }

  const lines = ["Dashboard summary."];
  if (dashboard.managementSummary) {
    lines.push(`Management: ${summarizeScalar(dashboard.managementSummary, 900)}`);
  }
  if (dashboard.documentCount !== undefined) {
    lines.push(`Documents: ${summarizeScalar(dashboard.documentCount, 40)}`);
  }
  if (Array.isArray(dashboard.connectors)) {
    lines.push(
      ...summarizeArrayItems(
        dashboard.connectors,
        summarizeResultItem,
      ),
    );
  }
  return truncate(lines.join("\n"));
}

function summarizeFilePayload(payload: Record<string, unknown>): string {
  const path = typeof payload.path === "string" ? payload.path : "unknown";
  const content = typeof payload.content === "string" ? payload.content : "";
  const truncatedFlag = payload.truncated === true;
  const lines = [
    `File: ${path}`,
    `Returned ${summarizeScalar(payload.returned_length ?? content.length, 40)} chars${truncatedFlag ? " (truncated)" : ""}.`,
  ];
  if (content.trim().length > 0) {
    lines.push("");
    lines.push(truncate(content, MAX_FILE_PREVIEW_CHARS));
  }
  return truncate(lines.join("\n"));
}

export function summarizeMcpToolPayloadForContent(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "No data.";
  }

  if (typeof payload === "string") {
    return truncate(payload);
  }

  if (Array.isArray(payload)) {
    const lines = [`Returned ${payload.length} item(s).`];
    lines.push(...summarizeArrayItems(payload, summarizeResultItem));
    return truncate(lines.join("\n"));
  }

  if (typeof payload !== "object") {
    return summarizeScalar(payload);
  }

  const record = payload as Record<string, unknown>;

  if (record.error) {
    const details = summarizeScalar(record.error, 600);
    return truncate(`Error: ${details}`);
  }

  if ("content" in record && "path" in record) {
    return summarizeFilePayload(record);
  }

  if (Array.isArray(record.results)) {
    return summarizeResultsPayload(record);
  }

  if (Array.isArray(record.data) && looksLikeEntityList(record.data)) {
    return summarizeResultsPayload({
      ...record,
      results: record.data,
    });
  }

  if (Array.isArray(record.documents)) {
    return summarizeDocumentsPayload(record);
  }

  if (Array.isArray(record.data)) {
    return summarizePeoplePayload(record);
  }

  if (Array.isArray(record.connectors)) {
    return summarizeConnectorsPayload(record);
  }

  if (record.dashboard && typeof record.dashboard === "object") {
    return summarizeDashboardPayload(record);
  }

  const scalarEntries = Object.entries(record)
    .filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return false;
      return typeof value !== "object";
    })
    .slice(0, 10)
    .map(([key, value]) => `${key}: ${summarizeScalar(value, 140)}`);

  if (scalarEntries.length > 0) {
    return truncate(scalarEntries.join("\n"));
  }

  return truncate(summarizeScalar(record));
}
