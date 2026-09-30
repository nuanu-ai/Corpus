export type CompanyImportMetadata = {
  source?: string;
  externalCompanyId?: string | null;
  organizationId?: string | null;
  externalParentCompanyId?: string | null;
  parentCompanyId?: string | null;
  importedAt?: string | null;
};

export type CompanyCompetitorSeed = {
  name: string;
  website: string | null;
  note: string | null;
};

export type CompanyBusinessProfileAdditions = {
  version: 1;
  marketResearchSummary: string | null;
  targetMarkets: string[];
  customerSegments: string[];
  productLines: string[];
  competitorSeeds: CompanyCompetitorSeed[];
  notes: string | null;
  source: "settings_ui" | "agent_api" | "manual";
  updatedAt: string | null;
};

export type CompanySettings = Record<string, unknown> & {
  companyDescription?: string;
  importMetadata?: CompanyImportMetadata;
  documentImportTemplates?: unknown[];
  businessProfileAdditions?: CompanyBusinessProfileAdditions;
  manualMarketContext?: unknown;
};

const MAX_COMPANY_DESCRIPTION_LENGTH = 4_000;
const MAX_MANUAL_MARKET_RESEARCH_LENGTH = 6_000;
const MAX_MANUAL_MARKET_SOURCE_NOTE_LENGTH = 1_000;
const MAX_COMPETITOR_NAME_LENGTH = 160;
const MAX_COMPETITOR_WEBSITE_LENGTH = 240;
const MAX_COMPETITOR_NOTES_LENGTH = 1_500;
const MAX_MANUAL_COMPETITORS = 25;
const MAX_PROFILE_ADDITION_LIST_ITEMS = 32;
const MAX_PROFILE_ADDITION_LIST_ITEM_LENGTH = 120;

export function coerceCompanySettings(value: unknown): CompanySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

export function normalizeCompanyDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_COMPANY_DESCRIPTION_LENGTH);
}

export function getCompanyDescription(value: unknown): string | null {
  const settings = coerceCompanySettings(value);
  return normalizeCompanyDescription(settings.companyDescription);
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = normalizeText(item, MAX_PROFILE_ADDITION_LIST_ITEM_LENGTH);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= MAX_PROFILE_ADDITION_LIST_ITEMS) break;
  }
  return normalized;
}

export function normalizeCompanyBusinessProfileAdditions(value: unknown): CompanyBusinessProfileAdditions {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const competitorsRaw = Array.isArray(raw.competitorSeeds)
    ? raw.competitorSeeds
    : Array.isArray(raw.competitors)
      ? raw.competitors
      : [];
  const competitorSeeds: CompanyCompetitorSeed[] = [];
  const seen = new Set<string>();

  for (const item of competitorsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = normalizeText(record.name, MAX_COMPETITOR_NAME_LENGTH);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    competitorSeeds.push({
      name,
      website: normalizeText(record.website, MAX_COMPETITOR_WEBSITE_LENGTH),
      note:
        normalizeText(record.note, MAX_COMPETITOR_NOTES_LENGTH) ??
        normalizeText(record.notes, MAX_COMPETITOR_NOTES_LENGTH),
    });
    if (competitorSeeds.length >= MAX_MANUAL_COMPETITORS) break;
  }

  return {
    version: 1,
    marketResearchSummary:
      normalizeText(raw.marketResearchSummary, MAX_MANUAL_MARKET_RESEARCH_LENGTH) ??
      normalizeText(raw.marketResearch, MAX_MANUAL_MARKET_RESEARCH_LENGTH) ??
      normalizeText(raw.summary, MAX_MANUAL_MARKET_RESEARCH_LENGTH),
    targetMarkets: normalizeStringList(raw.targetMarkets),
    customerSegments: normalizeStringList(raw.customerSegments),
    productLines: normalizeStringList(raw.productLines),
    competitorSeeds,
    notes:
      normalizeText(raw.notes, MAX_MANUAL_MARKET_SOURCE_NOTE_LENGTH) ??
      normalizeText(raw.sourceNote, MAX_MANUAL_MARKET_SOURCE_NOTE_LENGTH),
    source: raw.source === "settings_ui" || raw.source === "agent_api" ? raw.source : "manual",
    updatedAt: normalizeIsoDate(raw.updatedAt),
  };
}

export function getCompanyBusinessProfileAdditions(value: unknown): CompanyBusinessProfileAdditions {
  const settings = coerceCompanySettings(value);
  return normalizeCompanyBusinessProfileAdditions(
    settings.businessProfileAdditions ?? settings.manualMarketContext,
  );
}

export function withCompanyBusinessProfileAdditions(
  value: unknown,
  context: unknown,
): CompanySettings {
  const settings = coerceCompanySettings(value);
  const normalized = normalizeCompanyBusinessProfileAdditions(context);
  if (
    normalized.marketResearchSummary ||
    normalized.targetMarkets.length > 0 ||
    normalized.customerSegments.length > 0 ||
    normalized.productLines.length > 0 ||
    normalized.competitorSeeds.length > 0 ||
    normalized.notes
  ) {
    settings.businessProfileAdditions = normalized;
  } else {
    delete settings.businessProfileAdditions;
  }
  delete settings.manualMarketContext;
  return settings;
}

export function withCompanyDescription(
  value: unknown,
  description: string | null | undefined,
): CompanySettings {
  const settings = coerceCompanySettings(value);
  const normalized = normalizeCompanyDescription(description);
  if (normalized) {
    settings.companyDescription = normalized;
  } else {
    delete settings.companyDescription;
  }
  return settings;
}

export function withImportMetadata(
  value: unknown,
  metadata: CompanyImportMetadata,
): CompanySettings {
  const settings = coerceCompanySettings(value);
  const current =
    settings.importMetadata && typeof settings.importMetadata === "object" && !Array.isArray(settings.importMetadata)
      ? (settings.importMetadata as Record<string, unknown>)
      : {};
  settings.importMetadata = {
    ...current,
    ...metadata,
  };
  return settings;
}
