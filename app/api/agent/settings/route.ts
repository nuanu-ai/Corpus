import { NextRequest, NextResponse } from "next/server";
import { eq, sql, type SQL } from "drizzle-orm";

import {
  getApiKeyCompanyContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import {
  getCompanyBusinessProfileAdditions,
  getCompanyDescription,
  normalizeCompanyBusinessProfileAdditions,
  normalizeCompanyDescription,
} from "@/lib/company-settings";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

const MANAGER_ROLES = new Set(["owner", "admin"]);

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{3,5}$/.test(normalized)) return null;
  return normalized;
}

function normalizeAliases(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const alias = item.replace(/\s+/g, " ").trim();
    if (!alias) continue;
    if (alias.length > 80) return null;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(alias);
  }
  return normalized.length <= 32 ? normalized : null;
}

function normalizeBusinessProfileAdditionsForAgentWrite(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return normalizeCompanyBusinessProfileAdditions({
    ...raw,
    source: raw.source ?? "agent_api",
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  });
}

async function loadCompany(companyId: string) {
  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      jurisdiction: companies.jurisdiction,
      entityType: companies.entityType,
      businessType: companies.businessType,
      website: companies.website,
      aliases: companies.aliases,
      reportingCurrency: companies.reportingCurrency,
      companyDbPort: companies.companyDbPort,
      settings: companies.settings,
      createdAt: companies.createdAt,
      updatedAt: companies.updatedAt,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return company ?? null;
}

export async function GET() {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "settings.read");

    const company = await loadCompany(membership.companyId);
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json({
      company,
      companyProfile: {
        website: company.website,
        businessType: company.businessType,
        jurisdiction: company.jurisdiction,
        entityType: company.entityType,
        aliases: company.aliases ?? [],
        reportingCurrency: company.reportingCurrency,
        companyDescription: getCompanyDescription(company.settings),
        businessProfileAdditions: getCompanyBusinessProfileAdditions(company.settings),
      },
      access: {
        role: membership.role,
        companyScopeMode: apiKey.companyScopeMode,
        defaultCompanyId: apiKey.defaultCompanyId,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "settings.write");

    if (!MANAGER_ROLES.has(membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = stringOrNull(body.name);
    const jurisdiction = body.jurisdiction === null ? null : stringOrNull(body.jurisdiction);
    const entityType = body.entityType === null ? null : stringOrNull(body.entityType);
    const businessType = body.businessType === null ? null : stringOrNull(body.businessType);
    const website = body.website === null ? null : stringOrNull(body.website);
    const reportingCurrency = body.reportingCurrency === undefined
      ? undefined
      : normalizeCurrency(body.reportingCurrency);
    const companyDescription =
      body.companyDescription === undefined
        ? undefined
        : normalizeCompanyDescription(body.companyDescription);
    const aliases = body.aliases === undefined ? undefined : normalizeAliases(body.aliases);
    const businessProfileAdditions =
      body.businessProfileAdditions === undefined
        ? undefined
        : normalizeBusinessProfileAdditionsForAgentWrite(body.businessProfileAdditions);

    if (name !== null && name.length > 120) {
      return NextResponse.json(
        { error: "Company name must be 120 characters or fewer" },
        { status: 400 },
      );
    }
    if (body.reportingCurrency !== undefined && reportingCurrency === null) {
      return NextResponse.json(
        { error: "reportingCurrency must be a valid currency code (e.g. USD)" },
        { status: 400 },
      );
    }
    if (body.aliases !== undefined && aliases === null) {
      return NextResponse.json(
        { error: "aliases must be an array of up to 32 strings, 80 characters each" },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: {
      updatedAt: Date;
      name?: string;
      jurisdiction?: string | null;
      entityType?: string | null;
      businessType?: string | null;
      website?: string | null;
      aliases?: string[];
      reportingCurrency?: string;
      // DATA-3: settings is a SQL expression (path-scoped jsonb_set chain) when
      // description/businessProfileAdditions are written.
      settings?: SQL;
    } = {
      updatedAt: new Date(),
    };

    if (name !== null) values.name = name;
    if (body.jurisdiction !== undefined) values.jurisdiction = jurisdiction;
    if (body.entityType !== undefined) values.entityType = entityType;
    if (body.businessType !== undefined) values.businessType = businessType;
    if (body.website !== undefined) values.website = website;
    if (aliases !== undefined && aliases !== null) values.aliases = aliases;
    if (reportingCurrency !== undefined && reportingCurrency !== null) {
      values.reportingCurrency = reportingCurrency;
    }
    if (body.companyDescription !== undefined || businessProfileAdditions !== undefined) {
      // DATA-3: path-scoped settings writes so sibling keys are never clobbered.
      let settingsSql = sql`COALESCE(${companies.settings}, '{}'::jsonb)`;

      if (body.companyDescription !== undefined) {
        if (companyDescription) {
          settingsSql = sql`jsonb_set(${settingsSql}, '{companyDescription}', ${JSON.stringify(companyDescription)}::jsonb, true)`;
        } else {
          settingsSql = sql`${settingsSql} #- '{companyDescription}'`;
        }
      }

      if (businessProfileAdditions !== undefined) {
        const normalized = normalizeCompanyBusinessProfileAdditions(businessProfileAdditions);
        const hasContent =
          normalized.marketResearchSummary ||
          normalized.targetMarkets.length > 0 ||
          normalized.customerSegments.length > 0 ||
          normalized.productLines.length > 0 ||
          normalized.competitorSeeds.length > 0 ||
          normalized.notes;
        if (hasContent) {
          settingsSql = sql`jsonb_set(${settingsSql}, '{businessProfileAdditions}', ${JSON.stringify(normalized)}::jsonb, true)`;
        } else {
          settingsSql = sql`${settingsSql} #- '{businessProfileAdditions}'`;
        }
        // Remove legacy manualMarketContext whenever businessProfileAdditions is touched
        settingsSql = sql`${settingsSql} #- '{manualMarketContext}'`;
      }

      values.settings = settingsSql;
    }

    const [updated] = await db
      .update(companies)
      .set(values)
      .where(eq(companies.id, membership.companyId))
      .returning({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        jurisdiction: companies.jurisdiction,
        entityType: companies.entityType,
        businessType: companies.businessType,
        website: companies.website,
        aliases: companies.aliases,
        reportingCurrency: companies.reportingCurrency,
        companyDbPort: companies.companyDbPort,
        settings: companies.settings,
        createdAt: companies.createdAt,
        updatedAt: companies.updatedAt,
      });

    if (!updated) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json({
      company: updated,
      companyProfile: {
        website: updated.website,
        businessType: updated.businessType,
        jurisdiction: updated.jurisdiction,
        entityType: updated.entityType,
        aliases: updated.aliases ?? [],
        reportingCurrency: updated.reportingCurrency,
        companyDescription: getCompanyDescription(updated.settings),
        businessProfileAdditions: getCompanyBusinessProfileAdditions(updated.settings),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
