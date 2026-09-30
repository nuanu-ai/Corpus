import { allocateNextCompanyDbPort, ensureCompanyProvisioned } from "@/lib/company-db/provisioning";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { normalizeCompanyDescription, withCompanyDescription } from "@/lib/company-settings";
import { db } from "@/lib/db";
import { companies, companyMembers } from "@/lib/db/schema";

export function normalizeReportingCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{3,5}$/.test(normalized)) return null;
  return normalized;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

export type CreateCompanyForUserInput = {
  userId: string;
  name: string;
  jurisdiction?: unknown;
  entityType?: unknown;
  businessType?: unknown;
  website?: unknown;
  reportingCurrency?: unknown;
  companyDescription?: unknown;
};

export type CreateCompanyForUserResult = {
  company: {
    id: string;
    name: string;
    slug: string | null;
    jurisdiction: string | null;
    entityType: string | null;
    businessType: string | null;
    reportingCurrency: string;
    settings: Record<string, unknown> | null;
    companyDbPort: number;
    role: "owner";
  };
  provisioning: {
    ok: boolean;
    error?: string;
  };
};

export async function createCompanyForUser(
  input: CreateCompanyForUserInput,
): Promise<CreateCompanyForUserResult> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Company name is required");
  }
  if (name.length > 120) {
    throw new Error("Company name must be 120 characters or fewer");
  }

  const reportingCurrency = normalizeReportingCurrency(input.reportingCurrency);
  if (input.reportingCurrency !== undefined && reportingCurrency === null) {
    throw new Error("reportingCurrency must be a valid currency code (e.g. USD)");
  }

  const companyDescription = normalizeCompanyDescription(input.companyDescription);

  const company = await db.transaction(async (tx) => {
    const companyDbPort = await allocateNextCompanyDbPort(tx);

    const [inserted] = await tx
      .insert(companies)
      .values({
        name,
        jurisdiction: stringOrNull(input.jurisdiction),
        entityType: stringOrNull(input.entityType),
        businessType: stringOrNull(input.businessType),
        website: stringOrNull(input.website),
        reportingCurrency: reportingCurrency ?? "USD",
        settings: withCompanyDescription({}, companyDescription),
        companyDbPort,
        provisioningStatus: "pending",
      })
      .returning({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        jurisdiction: companies.jurisdiction,
        entityType: companies.entityType,
        businessType: companies.businessType,
        reportingCurrency: companies.reportingCurrency,
        settings: companies.settings,
        companyDbPort: companies.companyDbPort,
      });

    if (!inserted) {
      throw new Error("Company creation failed");
    }

    await tx.insert(companyMembers).values({
      companyId: inserted.id,
      userId: input.userId,
      role: "owner",
    });

    return inserted;
  });

  let provisioning: CreateCompanyForUserResult["provisioning"] = { ok: true };
  let slug = company.slug;
  try {
    await ensureCompanyProvisioned(company.id);
    if (!slug) {
      slug = await getCompanySlug(company.id);
    }
  } catch (err) {
    provisioning = {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown provisioning error",
    };
    console.error(`[companies] Provisioning failed for company=${company.id}`, err);
  }

  return {
    company: {
      ...company,
      slug,
      role: "owner",
    },
    provisioning,
  };
}
