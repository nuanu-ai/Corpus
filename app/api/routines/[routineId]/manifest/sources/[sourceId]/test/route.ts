import { NextResponse } from "next/server";

import {
  getAuthContext,
  handleApiError,
  requireApiKeyScope,
  requireCompanyDbDomainAccess,
} from "@/lib/api-auth";
import { ForbiddenError } from "@/lib/errors";
import {
  collectReportAutomationSourceEvidence,
} from "@/lib/report-jobs/source-adapters";
import {
  createReportSourceEvidenceSnapshot,
} from "@/lib/report-jobs/source-evidence";
import type { ReportIntent } from "@/lib/report-jobs/types";
import {
  requireRoutineDomainAccess,
  requireRoutinePolicyAdmin,
} from "@/lib/routines/api-access";
import { buildAutomationManifestV1 } from "@/lib/routines/manifest";
import {
  getCompanyRoutine,
  listRoutineSources,
  recordRoutineAuditLog,
} from "@/lib/routines/store";
import {
  DAILY_FINANCE_REPORT_TEMPLATE_KEY,
  MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY,
  WEEKLY_OPERATING_REPORT_TEMPLATE_KEY,
  isReportAutomationTemplateKey,
} from "@/lib/routines/types";
import type { ApiKeyScope } from "@/lib/api-key-scopes";

function formatLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function smokeReportIntent(input: {
  companyId: string;
  templateKey: string;
  requestTitle: string;
  now?: Date;
}): ReportIntent {
  const timezone = "UTC";
  const end = input.now ?? new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startDate = formatLocalDate(start, timezone);
  const endDate = formatLocalDate(end, timezone);
  const reportFamily = input.templateKey === MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY
    ? "financial_analysis"
    : "revenue_report";
  const dimensions = input.templateKey === WEEKLY_OPERATING_REPORT_TEMPLATE_KEY ||
    input.templateKey === MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY
    ? ["venue"]
    : [];
  const outputFormat = input.templateKey === DAILY_FINANCE_REPORT_TEMPLATE_KEY ? "markdown" : "xlsx";

  return {
    request: `Test source collection for ${input.requestTitle}`,
    companyId: input.companyId,
    reportFamily,
    subject: "finance",
    period: {
      kind: "absolute_range",
      label: `${startDate} to ${endDate}`,
      startDate,
      endDate,
      timezone,
    },
    dimensions,
    metrics: ["revenue", "expense", "net"],
    filters: {},
    operatingScope: null,
    outputFormat,
    strictness: "standard",
    needsClarification: false,
    clarificationQuestions: [],
  };
}

function requireConnectorSourceAccess(input: {
  auth: Awaited<ReturnType<typeof getAuthContext>>;
  requiredScope: ApiKeyScope;
}) {
  requireApiKeyScope(input.auth, input.requiredScope);
  if (input.auth.companyAccessSource !== "inherited") return;
  const allowed = new Set(input.auth.companyAllowedConnectorScopes ?? []);
  if (allowed.has(input.requiredScope)) return;
  throw new ForbiddenError(
    `Inherited access to this company does not include connector scope: ${input.requiredScope}`,
  );
}

function requireManifestSourceAccess(
  auth: Awaited<ReturnType<typeof getAuthContext>>,
  source: ReturnType<typeof buildAutomationManifestV1>["sources"][number],
) {
  if (source.type === "company_db") {
    requireApiKeyScope(auth, "company_db.read");
    for (const domain of source.companyDb?.domains ?? ["finance"]) {
      requireCompanyDbDomainAccess(auth, domain, "read");
    }
    return;
  }

  if (source.id === "documents" || source.type === "document_folder") {
    requireApiKeyScope(auth, "documents.read");
    return;
  }

  if (source.connector?.provider === "odoo") {
    requireConnectorSourceAccess({ auth, requiredScope: "connectors.use.odoo" });
    return;
  }

  if (source.connector?.provider === "custom_mcp") {
    requireConnectorSourceAccess({ auth, requiredScope: "connectors.use.custom_mcp" });
    return;
  }

  throw new ForbiddenError(`Source ${source.id} is not testable through the report source endpoint`);
}

async function auditManifestSourceTest(input: {
  companyId: string;
  userId: string | null;
  routineId: string;
  sourceId: string;
  ok: boolean;
  status?: string | null;
  error?: string | null;
}) {
  try {
    await recordRoutineAuditLog({
      companyId: input.companyId,
      userId: input.userId,
      action: "routine_manifest_source_tested",
      entityType: "routine_source",
      entityId: input.sourceId,
      newValue: {
        ok: input.ok,
        status: input.status ?? null,
      },
      details: {
        routineId: input.routineId,
        error: input.error ?? null,
      },
    });
  } catch (error) {
    console.warn("[routines] failed to audit manifest source test", error);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ routineId: string; sourceId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, sourceId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");
    requireRoutinePolicyAdmin(auth);

    if (!isReportAutomationTemplateKey(routine.templateKey)) {
      return NextResponse.json(
        { error: "Manifest source test is only enabled for report automation routines" },
        { status: 400 },
      );
    }

    const sources = await listRoutineSources(auth.companyId, routineId);
    const manifest = buildAutomationManifestV1({ routine, sources });
    const source = manifest.sources.find((item) => item.id === sourceId);
    if (!source) return NextResponse.json({ error: "Manifest source not found" }, { status: 404 });

    requireManifestSourceAccess(auth, source);

    const intent = smokeReportIntent({
      companyId: auth.companyId,
      templateKey: routine.templateKey,
      requestTitle: routine.title,
    });
    const result = await collectReportAutomationSourceEvidence({
      companyId: auth.companyId,
      intent,
      source,
      baseUrl: new URL(req.url).origin,
    });
    const snapshot = createReportSourceEvidenceSnapshot([result.source]);
    const ok = result.source.status === "available" || result.source.status === "partial";
    await auditManifestSourceTest({
      companyId: auth.companyId,
      userId: auth.userId,
      routineId,
      sourceId,
      ok,
      status: result.source.status,
      error: result.source.error ?? null,
    });

    return NextResponse.json({
      ok,
      source: snapshot.sources[0],
      snapshot,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
