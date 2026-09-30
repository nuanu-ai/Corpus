import { EXAMPLE_STRUCTURE_ROWS } from "./example-raw-seed";
import { normalizeOperatingSearchKey } from "./normalization";
import type { OperatingEntityMatch, OperatingEntityRecord, OperatingEntityRegistry } from "./types";

const DEFAULT_METRIC_RULES = {
  revenueBasis: "unknown" as const,
  costBasis: "unknown" as const,
  cashBasis: "unknown" as const,
};

const DEFAULT_ECONOMIC_MODEL = { ownership: "unknown" as const };

function record(input: Omit<OperatingEntityRecord, "metricRules" | "economicModel" | "sourceRows"> & {
  sourceRowIndexes?: number[];
}): OperatingEntityRecord {
  return {
    ...input,
    metricRules: DEFAULT_METRIC_RULES,
    economicModel: DEFAULT_ECONOMIC_MODEL,
    sourceRows: (input.sourceRowIndexes ?? []).map((index) => EXAMPLE_STRUCTURE_ROWS[index]).filter(Boolean),
  };
}

const EXAMPLE_RECORDS: OperatingEntityRecord[] = [
  record({
    id: "domain:example-holdings", canonicalName: "Example Holdings", objectType: "operating_domain", status: "confirmed",
    aliases: ["Example Holdings Group"], parentIds: [], legalEntityIds: ["legal:example-holdings-ltd"], partnerIds: [],
    sourceMappings: { companyDb: { queryAliases: ["Example Holdings", "Example Holdings Group"] } }, confidence: "high",
    notes: ["Synthetic organization used for local development."], tags: ["synthetic", "example"], sourceRowIndexes: [0],
  }),
  record({
    id: "legal:example-holdings-ltd", canonicalName: "Example Holdings Ltd", objectType: "legal_entity", status: "confirmed",
    aliases: ["Example Holdings"], parentIds: ["domain:example-holdings"], legalEntityIds: [], partnerIds: [],
    sourceMappings: { companyDb: { queryAliases: ["Example Holdings Ltd"] } }, confidence: "high",
    notes: [], tags: ["synthetic", "legal-entity"], sourceRowIndexes: [0],
  }),
  record({
    id: "project:northstar", canonicalName: "Project Northstar", objectType: "project", status: "confirmed",
    aliases: ["Northstar"], parentIds: ["domain:example-holdings"], legalEntityIds: ["legal:example-holdings-ltd"], partnerIds: [],
    sourceMappings: { companyDb: { queryAliases: ["Project Northstar", "Northstar"] }, odoo: { analyticAccounts: ["Project Northstar"] } },
    confidence: "high", notes: [], tags: ["synthetic", "project"], sourceRowIndexes: [1],
  }),
  record({
    id: "project:beacon", canonicalName: "Project Beacon", objectType: "project", status: "confirmed",
    aliases: ["Beacon"], parentIds: ["domain:example-holdings"], legalEntityIds: ["legal:example-holdings-ltd"], partnerIds: [],
    sourceMappings: { companyDb: { queryAliases: ["Project Beacon", "Beacon"] } }, confidence: "high",
    notes: [], tags: ["synthetic", "project"], sourceRowIndexes: [2],
  }),
  record({
    id: "department:finance", canonicalName: "Finance", objectType: "department", status: "confirmed",
    aliases: ["Finance Department"], parentIds: ["domain:example-holdings"], legalEntityIds: ["legal:example-holdings-ltd"], partnerIds: [],
    sourceMappings: { companyDb: { queryAliases: ["Finance", "Finance Department"] } }, confidence: "high",
    notes: [], tags: ["synthetic", "department"], sourceRowIndexes: [3],
  }),
];

export function buildOperatingEntityRegistry(): OperatingEntityRegistry {
  const records = EXAMPLE_RECORDS.map((item) => structuredClone(item));
  return {
    records,
    recordsById: new Map(records.map((item) => [item.id, item])),
    legalEntityNamesById: new Map(records.filter((item) => item.objectType === "legal_entity").map((item) => [item.id, item.canonicalName])),
    sourceWarnings: [],
  };
}

let cachedRegistry: OperatingEntityRegistry | null = null;

export function getOperatingEntityRegistry(): OperatingEntityRegistry {
  cachedRegistry ??= buildOperatingEntityRegistry();
  return cachedRegistry;
}

function scoreRecord(item: OperatingEntityRecord, query: string): OperatingEntityMatch | null {
  const normalizedQuery = normalizeOperatingSearchKey(query);
  if (!normalizedQuery) return null;
  let best: OperatingEntityMatch | null = null;
  for (const label of [item.canonicalName, ...item.aliases]) {
    const normalizedLabel = normalizeOperatingSearchKey(label);
    let score = 0;
    let matchKind: OperatingEntityMatch["matchKind"] = "token";
    if (normalizedQuery === normalizedLabel) { score = 100; matchKind = "exact"; }
    else if (normalizedQuery.includes(normalizedLabel) || normalizedLabel.includes(normalizedQuery)) { score = 80; matchKind = "contains"; }
    else {
      const tokens = normalizedLabel.split(" ").filter((token) => token.length > 2);
      const matched = tokens.filter((token) => normalizedQuery.includes(token)).length;
      if (matched > 0) score = 50 + Math.round((matched / Math.max(tokens.length, 1)) * 20);
    }
    if (!best || score > best.score) best = { record: item, score, matchedTerm: label, matchKind };
  }
  return best && best.score >= 50 ? best : null;
}

export function resolveOperatingEntities(query: string, options?: { limit?: number }): OperatingEntityMatch[] {
  return getOperatingEntityRegistry().records
    .map((item) => scoreRecord(item, query))
    .filter((item): item is OperatingEntityMatch => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .slice(0, options?.limit ?? 8);
}

export function resolveOperatingEntity(query: string): OperatingEntityMatch | null {
  return resolveOperatingEntities(query, { limit: 1 })[0] ?? null;
}

export function expandOperatingEntitySearchTerms(query: string, options?: { limit?: number }): string[] {
  const registry = getOperatingEntityRegistry();
  const terms = new Set<string>();
  const matches = resolveOperatingEntities(query, { limit: options?.limit ?? 3 });
  if (matches.length === 0 && query.trim()) terms.add(query.trim());
  for (const match of matches) {
    terms.add(match.record.canonicalName);
    match.record.aliases.forEach((alias) => terms.add(alias));
    match.record.sourceMappings.companyDb?.queryAliases?.forEach((alias) => terms.add(alias));
    [...match.record.parentIds, ...match.record.legalEntityIds, ...match.record.partnerIds]
      .map((id) => registry.recordsById.get(id)?.canonicalName)
      .filter((name): name is string => Boolean(name))
      .forEach((name) => terms.add(name));
  }
  return [...terms];
}
