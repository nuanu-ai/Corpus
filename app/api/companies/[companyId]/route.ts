import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import {
  ACTIVE_COMPANY_COOKIE,
  ACTIVE_COMPANY_COOKIE_OPTIONS,
  getRequestedCompanyIdFromHeaders,
} from "@/lib/company-context";
import {
  getCompanyBusinessProfileAdditions,
  getCompanyDescription,
  normalizeCompanyBusinessProfileAdditions,
  normalizeCompanyDescription,
} from "@/lib/company-settings";
import { normalizeCurrencyCode } from "@/lib/finance/display-currency";
import { db } from "@/lib/db";
import {
  auditLog,
  canonicalTxns,
  chatApprovals,
  chatArtifacts,
  chatAttachments,
  chatMessages,
  chatRuns,
  chatThreads,
  communicationMessages,
  companies,
  companyMembers,
  connections,
  connectorRegistrations,
  documents,
  merchantRules,
  notifications,
  pendingSignals,
  rawEvents,
  reconciledTxns,
  reportConfigs,
  stagingRecords,
} from "@/lib/db/schema";
import { listCompanyMemberships, requireCompanyMembership } from "@/lib/db/tenant";
import { getPlatformAdminSession } from "@/lib/platform-admin";

const MANAGER_ROLES = new Set(["owner", "admin"]);
const DELETE_REPO_BASE = process.env.COMPANY_DB_REPO ?? "/data/companies";

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeBusinessProfileAdditionsForSessionWrite(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return normalizeCompanyBusinessProfileAdditions({
    ...raw,
    source: raw.source ?? "settings_ui",
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  try {
    const { userId } = await getSessionAuthContext();
    const { companyId } = await params;
    const membership = await requireCompanyMembership(userId, companyId);

    const [company] = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        jurisdiction: companies.jurisdiction,
        entityType: companies.entityType,
        businessType: companies.businessType,
        website: companies.website,
        settings: companies.settings,
        companyDbPort: companies.companyDbPort,
        parentCompanyId: companies.parentCompanyId,
        aliases: companies.aliases,
        reportingCurrency: companies.reportingCurrency,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json({
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        jurisdiction: company.jurisdiction,
        entityType: company.entityType,
        businessType: company.businessType,
        website: company.website,
        role: membership.role,
        companyDbPort: company.companyDbPort,
        companyDescription: getCompanyDescription(company.settings),
        businessProfileAdditions: getCompanyBusinessProfileAdditions(company.settings),
        parentCompanyId: company.parentCompanyId,
        aliases: company.aliases ?? [],
        reportingCurrency: company.reportingCurrency,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  try {
    const { userId } = await getSessionAuthContext();
    const { companyId } = await params;
    const membership = await requireCompanyMembership(userId, companyId);

    if (!MANAGER_ROLES.has(membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const nextName = typeof body.name === "string" ? body.name.trim() : "";
    if (!nextName) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (nextName.length > 120) {
      return NextResponse.json({ error: "Company name must be 120 characters or fewer" }, { status: 400 });
    }

    const [current] = await db
      .select({
        id: companies.id,
        slug: companies.slug,
        jurisdiction: companies.jurisdiction,
        entityType: companies.entityType,
        businessType: companies.businessType,
        website: companies.website,
        settings: companies.settings,
        companyDbPort: companies.companyDbPort,
        parentCompanyId: companies.parentCompanyId,
        aliases: companies.aliases,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const nextDescription = normalizeCompanyDescription(body.companyDescription);
    // Compute what businessProfileAdditions would be (if present in body), for
    // use both in the SQL write and the returned response shape.
    const nextBpa =
      "businessProfileAdditions" in body
        ? (() => {
            const normalized = normalizeBusinessProfileAdditionsForSessionWrite(
              body.businessProfileAdditions,
            );
            const hasContent =
              normalized.marketResearchSummary ||
              normalized.targetMarkets.length > 0 ||
              normalized.customerSegments.length > 0 ||
              normalized.productLines.length > 0 ||
              normalized.competitorSeeds.length > 0 ||
              normalized.notes;
            return { normalized, hasContent };
          })()
        : null;

    const nextJurisdiction =
      "jurisdiction" in body ? (body.jurisdiction === null ? null : stringOrNull(body.jurisdiction)) : undefined;
    const nextEntityType =
      "entityType" in body ? (body.entityType === null ? null : stringOrNull(body.entityType)) : undefined;
    const nextBusinessType =
      "businessType" in body ? (body.businessType === null ? null : stringOrNull(body.businessType)) : undefined;
    const nextWebsite =
      "website" in body ? (body.website === null ? null : stringOrNull(body.website)) : undefined;

    // parentCompanyId: only present in body when the field is being updated.
    // Pass `null` to clear, omit to leave alone.
    const adminSession = await getPlatformAdminSession();
    const isPlatformAdmin = Boolean(adminSession?.user?.id === userId);

    let nextParentCompanyId: string | null | undefined = undefined;
    if ("parentCompanyId" in body) {
      const raw = body.parentCompanyId;
      if (raw === null || raw === "") {
        nextParentCompanyId = null;
      } else if (typeof raw === "string") {
        if (raw === companyId) {
          return NextResponse.json(
            { error: "A company cannot be its own parent" },
            { status: 400 },
          );
        }
        const [parent] = await db
          .select({ id: companies.id, parentCompanyId: companies.parentCompanyId })
          .from(companies)
          .where(eq(companies.id, raw))
          .limit(1);
        if (!parent) {
          return NextResponse.json(
            { error: "parentCompanyId does not match any company" },
            { status: 400 },
          );
        }
        // Walk up to detect cycle.
        let cursor: string | null = parent.parentCompanyId;
        const seen = new Set<string>([parent.id]);
        for (let depth = 0; depth < 32 && cursor; depth += 1) {
          if (cursor === companyId) {
            return NextResponse.json(
              { error: "Setting that parent would create a cycle" },
              { status: 400 },
            );
          }
          if (seen.has(cursor)) break;
          seen.add(cursor);
          const [next] = await db
            .select({ parentCompanyId: companies.parentCompanyId })
            .from(companies)
            .where(eq(companies.id, cursor))
            .limit(1);
          cursor = next?.parentCompanyId ?? null;
        }
        // Non-platform-admins must also have membership in the parent — otherwise
        // you could re-parent your company under any company id.
        if (!isPlatformAdmin) {
          try {
            await requireCompanyMembership(userId, raw);
          } catch {
            return NextResponse.json(
              { error: "You don't have access to the requested parent company" },
              { status: 403 },
            );
          }
        }
        nextParentCompanyId = raw;
      } else {
        return NextResponse.json(
          { error: "parentCompanyId must be a string or null" },
          { status: 400 },
        );
      }
    }

    // reportingCurrency: optional. Reject only when present-but-invalid; otherwise leave alone.
    let nextReportingCurrency: string | undefined = undefined;
    if ("reportingCurrency" in body) {
      if (typeof body.reportingCurrency !== "string") {
        return NextResponse.json(
          { error: "reportingCurrency must be a 3-5 letter ISO code (e.g. USD, IDR)" },
          { status: 400 },
        );
      }
      const normalized = normalizeCurrencyCode(body.reportingCurrency);
      if (!normalized) {
        return NextResponse.json(
          { error: "reportingCurrency must be a 3-5 letter ISO code (e.g. USD, IDR)" },
          { status: 400 },
        );
      }
      nextReportingCurrency = normalized;
    }

    let nextAliases: string[] | undefined = undefined;
    if ("aliases" in body) {
      const raw = body.aliases;
      if (!Array.isArray(raw)) {
        return NextResponse.json(
          { error: "aliases must be an array of strings" },
          { status: 400 },
        );
      }
      const normalized: string[] = [];
      const seenLower = new Set<string>();
      for (const item of raw) {
        if (typeof item !== "string") continue;
        const trimmed = item.replace(/\s+/g, " ").trim();
        if (!trimmed) continue;
        if (trimmed.length > 80) {
          return NextResponse.json(
            { error: "Each alias must be 80 characters or fewer" },
            { status: 400 },
          );
        }
        const lower = trimmed.toLowerCase();
        if (seenLower.has(lower)) continue;
        seenLower.add(lower);
        normalized.push(trimmed);
      }
      if (normalized.length > 32) {
        return NextResponse.json(
          { error: "A company can have at most 32 aliases" },
          { status: 400 },
        );
      }
      nextAliases = normalized;
    }

    // DATA-3: path-scoped settings writes. Build the SQL expression
    // incrementally — one jsonb_set / #- per key — so concurrent writes to
    // other sub-paths are never clobbered.
    let settingsSql = sql`COALESCE(${companies.settings}, '{}'::jsonb)`;

    // companyDescription
    if (nextDescription) {
      settingsSql = sql`jsonb_set(${settingsSql}, '{companyDescription}', ${JSON.stringify(nextDescription)}::jsonb, true)`;
    } else {
      settingsSql = sql`${settingsSql} #- '{companyDescription}'`;
    }

    // businessProfileAdditions (only when field was explicitly sent)
    if (nextBpa !== null) {
      if (nextBpa.hasContent) {
        settingsSql = sql`jsonb_set(${settingsSql}, '{businessProfileAdditions}', ${JSON.stringify(nextBpa.normalized)}::jsonb, true)`;
      } else {
        settingsSql = sql`${settingsSql} #- '{businessProfileAdditions}'`;
      }
      // Remove legacy manualMarketContext whenever businessProfileAdditions is touched
      settingsSql = sql`${settingsSql} #- '{manualMarketContext}'`;
    }

    const [updated] = await db
      .update(companies)
      .set({
        name: nextName,
        settings: settingsSql,
        ...(nextJurisdiction !== undefined ? { jurisdiction: nextJurisdiction } : {}),
        ...(nextEntityType !== undefined ? { entityType: nextEntityType } : {}),
        ...(nextBusinessType !== undefined ? { businessType: nextBusinessType } : {}),
        ...(nextWebsite !== undefined ? { website: nextWebsite } : {}),
        ...(nextParentCompanyId !== undefined ? { parentCompanyId: nextParentCompanyId } : {}),
        ...(nextAliases !== undefined ? { aliases: nextAliases } : {}),
        ...(nextReportingCurrency !== undefined ? { reportingCurrency: nextReportingCurrency } : {}),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId))
      .returning({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        jurisdiction: companies.jurisdiction,
        entityType: companies.entityType,
        businessType: companies.businessType,
        website: companies.website,
        settings: companies.settings,
        companyDbPort: companies.companyDbPort,
        parentCompanyId: companies.parentCompanyId,
        aliases: companies.aliases,
        reportingCurrency: companies.reportingCurrency,
      });

    return NextResponse.json({
      company: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        jurisdiction: updated.jurisdiction,
        entityType: updated.entityType,
        businessType: updated.businessType,
        website: updated.website,
        role: membership.role,
        companyDbPort: updated.companyDbPort,
        companyDescription: getCompanyDescription(updated.settings),
        businessProfileAdditions: getCompanyBusinessProfileAdditions(updated.settings),
        parentCompanyId: updated.parentCompanyId,
        aliases: updated.aliases ?? [],
        reportingCurrency: updated.reportingCurrency,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  try {
    const { userId } = await getSessionAuthContext();
    const { companyId } = await params;
    const adminSession = await getPlatformAdminSession();
    const isPlatformAdmin = Boolean(adminSession?.user?.id === userId);

    if (!isPlatformAdmin) {
      const membership = await requireCompanyMembership(userId, companyId);
      if (membership.role !== "owner") {
        return NextResponse.json(
          { error: "Only owners or platform admins can delete a company" },
          { status: 403 },
        );
      }
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const [current] = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const confirmName =
      typeof body.confirmName === "string" ? body.confirmName.trim() : "";
    if (!confirmName || confirmName !== current.name) {
      return NextResponse.json(
        { error: "Company name confirmation does not match" },
        { status: 400 },
      );
    }

    const companySlug = current.slug ?? null;

    await db.transaction(async (tx) => {
      await tx.delete(chatApprovals).where(eq(chatApprovals.companyId, companyId));
      await tx.delete(chatArtifacts).where(eq(chatArtifacts.companyId, companyId));
      await tx.delete(chatAttachments).where(eq(chatAttachments.companyId, companyId));
      await tx.delete(chatMessages).where(eq(chatMessages.companyId, companyId));
      await tx.delete(chatRuns).where(eq(chatRuns.companyId, companyId));
      await tx.delete(chatThreads).where(eq(chatThreads.companyId, companyId));
      await tx.delete(pendingSignals).where(eq(pendingSignals.companyId, companyId));
      await tx.delete(communicationMessages).where(eq(communicationMessages.companyId, companyId));
      await tx.delete(notifications).where(eq(notifications.companyId, companyId));
      await tx.delete(reconciledTxns).where(eq(reconciledTxns.companyId, companyId));
      await tx.delete(canonicalTxns).where(eq(canonicalTxns.companyId, companyId));
      await tx.delete(rawEvents).where(eq(rawEvents.companyId, companyId));
      await tx.delete(documents).where(eq(documents.companyId, companyId));
      await tx.delete(reportConfigs).where(eq(reportConfigs.companyId, companyId));
      await tx.delete(merchantRules).where(eq(merchantRules.companyId, companyId));
      await tx.delete(auditLog).where(eq(auditLog.companyId, companyId));
      await tx.delete(connections).where(eq(connections.companyId, companyId));
      await tx.delete(companyMembers).where(eq(companyMembers.companyId, companyId));

      if (companySlug) {
        await tx.delete(stagingRecords).where(eq(stagingRecords.companySlug, companySlug));
        await tx
          .delete(connectorRegistrations)
          .where(eq(connectorRegistrations.companySlug, companySlug));
      }

      await tx.delete(companies).where(eq(companies.id, companyId));
    });

    const remainingMemberships = await listCompanyMemberships(userId);
    const requestedCompanyId = getRequestedCompanyIdFromHeaders(await headers());
    const nextActiveCompanyId =
      remainingMemberships[0]?.companyId ?? null;

    const response = NextResponse.json({
      status: "ok",
      deletedCompanyId: companyId,
      deletedCompanyName: current.name,
      nextActiveCompanyId,
    });

    if (requestedCompanyId === companyId || remainingMemberships.length === 0) {
      if (nextActiveCompanyId) {
        response.cookies.set(
          ACTIVE_COMPANY_COOKIE,
          nextActiveCompanyId,
          ACTIVE_COMPANY_COOKIE_OPTIONS,
        );
      } else {
        response.cookies.set(ACTIVE_COMPANY_COOKIE, "", {
          ...ACTIVE_COMPANY_COOKIE_OPTIONS,
          maxAge: 0,
        });
      }
    }

    if (companySlug) {
      const repoBase = resolve(/* turbopackIgnore: true */ DELETE_REPO_BASE);
      const repoPath = resolve(repoBase, companySlug);
      const pathFromBase = relative(repoBase, repoPath);
      if (pathFromBase && !pathFromBase.startsWith("..") && !isAbsolute(pathFromBase)) {
        rm(/* turbopackIgnore: true */ repoPath, { recursive: true, force: true }).catch((error) => {
          console.warn(
            `[companies] Deleted company=${companyId} but failed to remove its Company-DB repository.`,
            error,
          );
        });
      } else {
        console.warn(`[companies] Skipped unsafe Company-DB path for deleted company=${companyId}.`);
      }
    }

    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
