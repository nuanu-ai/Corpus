import { eq } from "drizzle-orm";

import {
  queryEntities,
  searchEntities,
  type EntityResult,
  type EntityView,
} from "@/lib/company-db/client";
import { deriveEntitySourceProvenance } from "@/lib/company-db/provenance";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import {
  listDocumentsForCompany,
} from "@/lib/documents/operations";
import {
  loadOdooFinanceSnapshot,
  type ReportFinanceSnapshot,
} from "@/lib/report-jobs/odoo-finance";
import type { ReportSourceEvidenceInput } from "@/lib/report-jobs/source-evidence";
import type { ReportIntent } from "@/lib/report-jobs/types";
import type { AutomationSource } from "@/lib/routines/manifest";

type ReportDocumentEvidenceRow = Awaited<ReturnType<typeof listDocumentsForCompany>>["documents"][number];

export interface ReportSourceAdapterResult {
  source: ReportSourceEvidenceInput;
  payload?: {
    odooFinance?: ReportFinanceSnapshot;
    companyDbEvidence?: EntityResult[];
    documents?: ReportDocumentEvidenceRow[];
  };
}

export function summarizeReportSourceFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Source collection failed";
}

function emptyFinanceSnapshot(): ReportFinanceSnapshot {
  return {
    rows: [],
    breakdowns: [],
    totals: {
      revenueTotal: 0,
      expenseTotal: 0,
      netTotal: 0,
      currency: null,
      revenueCount: 0,
      expenseCount: 0,
    },
  };
}

function sourceUnavailableReason(error: unknown): boolean {
  const message = summarizeReportSourceFailure(error).toLowerCase();
  return (
    message.includes("not connected") ||
    message.includes("credentials are incomplete") ||
    message.includes("missing credentials") ||
    message.includes("not configured")
  );
}

export function failedReportSourceEvidence(input: {
  source: string;
  label: string;
  error: unknown;
  unavailable?: boolean;
}): ReportSourceEvidenceInput {
  const status = input.unavailable || sourceUnavailableReason(input.error) ? "unavailable" : "failed";
  return {
    source: input.source,
    status,
    label: input.label,
    reason: status === "unavailable"
      ? `${input.label} is not available for this report run.`
      : `${input.label} could not be collected for this report run.`,
    error: summarizeReportSourceFailure(input.error),
    counts: {},
    refs: [],
  };
}

async function loadCompanyDbOptions(companyId: string) {
  const companySlug = await getCompanySlug(companyId);
  const [company] = await db
    .select({ companyDbPort: companies.companyDbPort })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return {
    companySlug,
    callerId: "report-worker",
    callerRole: "owner",
    port: company?.companyDbPort ?? 3100,
  };
}

function companyDbEvidenceQueries(intent: ReportIntent): string[] {
  const values = [
    intent.request,
    intent.subject,
    intent.period.label,
    intent.period.startDate,
    intent.period.endDate,
    intent.reportFamily.replace(/_/g, " "),
    ...intent.metrics,
    ...intent.dimensions,
  ];
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value && value.length >= 3)),
    ),
  ).slice(0, 4);
}

function isAllowedDomain(row: EntityResult, domains: Set<string>): boolean {
  return domains.has(row.domain);
}

function normalizeDomains(domains: readonly string[] | undefined): string[] {
  const normalized = Array.from(
    new Set((domains ?? ["finance"]).map((domain) => domain.trim().toLowerCase()).filter(Boolean)),
  );
  return normalized.length > 0 ? normalized : ["finance"];
}

function companyDbSourceEvidence(rows: EntityResult[], domains: readonly string[]): ReportSourceEvidenceInput {
  return {
    source: "company_db",
    status: "available",
    label: "Company-DB evidence",
    reason: rows.length > 0
      ? "Collected compact Company-DB cross-check records."
      : "Company-DB query completed and returned no cross-check records.",
    counts: {
      records: rows.length,
      domains: domains.length,
    },
    metadata: {
      domains,
    },
    refs: rows.map((row) => {
      const provenance = deriveEntitySourceProvenance(row);
      return {
        id: row.qualifiedId,
        source: "company_db",
        title: row.title ?? row.qualifiedId,
        recordType: row.type || row.domain,
        observedAt: row.updatedAt ?? row.createdAt ?? undefined,
        url: provenance.originalDocument?.viewPath,
        metadata: {
          domain: row.domain,
          filePath: row.filePath,
          status: row.status,
          evidenceStatus: provenance.evidenceStatus,
          reviewPending: provenance.reviewPending,
          sourceDocumentId: provenance.originalDocument?.documentId,
        },
      };
    }),
  };
}

export async function collectReportCompanyDbSourceEvidence(input: {
  companyId: string;
  intent: ReportIntent;
  domains?: readonly string[];
  limit?: number;
}): Promise<ReportSourceAdapterResult> {
  const domains = normalizeDomains(input.domains);
  const domainSet = new Set(domains);
  const limit = input.limit ?? 10;

  try {
    const opts = await loadCompanyDbOptions(input.companyId);
    const view: EntityView = "summary";
    const targetedEntities = (
      await Promise.all(
        companyDbEvidenceQueries(input.intent).map((query) =>
          searchEntities(query, opts, { limit: 5, view }),
        ),
      )
    ).flat().filter((row) => isAllowedDomain(row, domainSet));
    const domainEntities = (
      await Promise.all(
        domains.map((domain) =>
          queryEntities(
            {
              domain,
              limit: 8,
              view,
            },
            opts,
          ),
        ),
      )
    ).flat();

    const deduped = new Map<string, EntityResult>();
    for (const row of targetedEntities) {
      deduped.set(row.qualifiedId, row);
    }
    for (const row of domainEntities) {
      deduped.set(row.qualifiedId, row);
    }
    const rows = [...deduped.values()].slice(0, limit);
    return {
      source: companyDbSourceEvidence(rows, domains),
      payload: { companyDbEvidence: rows },
    };
  } catch (error) {
    return {
      source: failedReportSourceEvidence({
        source: "company_db",
        label: "Company-DB evidence",
        error,
      }),
      payload: { companyDbEvidence: [] },
    };
  }
}

function odooSourceEvidence(finance: ReportFinanceSnapshot): ReportSourceEvidenceInput {
  const totalRows = finance.rows.length;
  return {
    source: "odoo",
    status: "available",
    label: "Odoo finance connector",
    reason: totalRows > 0
      ? "Collected bounded live Odoo finance rows for the report window."
      : "Odoo query completed and returned no finance rows for the report window.",
    counts: {
      rows: totalRows,
      revenueRows: finance.totals.revenueCount,
      expenseRows: finance.totals.expenseCount,
      breakdownRows: finance.breakdowns.length,
    },
    refs: finance.rows.slice(0, 20).map((row) => ({
      id: String(row.recordId),
      source: "odoo",
      title: row.name,
      recordType: row.sourceType,
      observedAt: row.invoiceDate ?? undefined,
      metadata: {
        moveType: row.moveType,
        partnerName: row.partnerName,
        paymentState: row.paymentState,
        currency: row.currency,
      },
    })),
  };
}

export async function collectReportOdooSourceEvidence(input: {
  intent: ReportIntent;
}): Promise<ReportSourceAdapterResult> {
  try {
    const finance = await loadOdooFinanceSnapshot(input.intent);
    return {
      source: odooSourceEvidence(finance),
      payload: { odooFinance: finance },
    };
  } catch (error) {
    return {
      source: failedReportSourceEvidence({
        source: "odoo",
        label: "Odoo finance connector",
        error,
      }),
      payload: { odooFinance: emptyFinanceSnapshot() },
    };
  }
}

function documentsSourceEvidence(input: {
  documents: ReportDocumentEvidenceRow[];
  total: number;
  hasMore: boolean;
}): ReportSourceEvidenceInput {
  return {
    source: "documents",
    status: input.hasMore ? "partial" : "available",
    label: "Processed company documents",
    reason: input.documents.length > 0
      ? "Collected bounded processed document evidence for the report context."
      : "Document index query completed and returned no processed documents.",
    counts: {
      documents: input.documents.length,
      total: input.total,
      hasMore: input.hasMore ? 1 : 0,
    },
    refs: input.documents.map((document) => ({
      id: document.id,
      source: "documents",
      title: document.fileName,
      recordType: document.documentType ?? document.fileType,
      observedAt: document.createdAt.toISOString(),
      url: document.sourceFile?.viewPath,
      metadata: {
        source: document.source,
        status: document.status,
        documentType: document.documentType,
        reportingPeriod: document.reportingPeriod,
        reviewRequired: document.reviewRequired,
      },
    })),
  };
}

export async function collectReportDocumentsSourceEvidence(input: {
  companyId: string;
  baseUrl?: string | null;
  limit?: number;
}): Promise<ReportSourceAdapterResult> {
  try {
    const result = await listDocumentsForCompany({
      companyId: input.companyId,
      limit: input.limit ?? 10,
      baseUrl: input.baseUrl ?? null,
    });
    return {
      source: documentsSourceEvidence({
        documents: result.documents,
        total: result.total,
        hasMore: result.hasMore,
      }),
      payload: { documents: result.documents },
    };
  } catch (error) {
    return {
      source: failedReportSourceEvidence({
        source: "documents",
        label: "Processed company documents",
        error,
      }),
      payload: { documents: [] },
    };
  }
}

export async function collectReportAutomationSourceEvidence(input: {
  companyId: string;
  intent: ReportIntent;
  source: AutomationSource;
  baseUrl?: string | null;
}): Promise<ReportSourceAdapterResult> {
  if (input.source.status !== "active") {
    return {
      source: {
        source: input.source.id,
        status: "unavailable",
        label: input.source.title,
        reason: `Source is ${input.source.status}.`,
        refs: [],
        counts: {},
      },
    };
  }

  if (input.source.id === "odoo" || input.source.connector?.provider === "odoo") {
    return collectReportOdooSourceEvidence({ intent: input.intent });
  }
  if (input.source.id === "documents" || input.source.type === "document_folder") {
    return collectReportDocumentsSourceEvidence({
      companyId: input.companyId,
      baseUrl: input.baseUrl,
      limit: 10,
    });
  }
  if (input.source.id === "company_db" || input.source.type === "company_db") {
    return collectReportCompanyDbSourceEvidence({
      companyId: input.companyId,
      intent: input.intent,
      domains: input.source.companyDb?.domains,
      limit: 10,
    });
  }
  return {
    source: {
      source: input.source.id,
      status: "unavailable",
      label: input.source.title,
      reason: `No report adapter is registered for ${input.source.type} source.`,
      refs: [],
      counts: {},
    },
  };
}
