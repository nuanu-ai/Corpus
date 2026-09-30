import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  getApiKeyAgentContext,
  handleApiError,
} from "@/lib/api-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { resolveApiKeyCompanyId } from "@/lib/api-key-access-runtime";

export async function GET(req: NextRequest) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
      })
      .from(users)
      .where(eq(users.id, apiKey.userId))
      .limit(1);

    const implicitCompanyId = resolveApiKeyCompanyId(null, companies, {
      companyScopeMode: apiKey.companyScopeMode,
      defaultCompanyId: apiKey.defaultCompanyId,
      allowedCompanyIds: apiKey.allowedCompanyIds,
    });

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);

    return NextResponse.json({
      authMethod: "api_key" as const,
      user: user ?? { id: apiKey.userId, email: null, name: null },
      apiKey: {
        id: apiKey.keyId,
        scopes: apiKey.scopes,
        companyScopeMode: apiKey.companyScopeMode,
        accessPolicyVersion: apiKey.accessPolicyVersion,
        defaultCompanyId: apiKey.defaultCompanyId,
        allowedCompanyIds: apiKey.allowedCompanyIds,
      },
      companyAccess: {
        implicitCompanyId,
        requiresCompanySelection:
          implicitCompanyId === null && companies.length > 1,
        companies: companies.map((company) => ({
          id: company.companyId,
          name: company.companyName,
          slug: company.companySlug,
          role: company.role,
          companyDbPort: company.companyDbPort,
          joinedAt: company.joinedAt,
          accessSource: company.accessSource ?? "direct",
          viaCompanyId: company.viaCompanyId ?? null,
          viaCompanyName: company.viaCompanyName ?? null,
          viaCompanySlug: company.viaCompanySlug ?? null,
          relationshipId: company.relationshipId ?? null,
          relationshipType: company.relationshipType ?? null,
          allowedDomains: company.allowedDomains ?? null,
          domainAccessLevels: company.domainAccessLevels ?? null,
          allowedConnectorScopes: company.allowedConnectorScopes ?? null,
          domainAccessSource: company.domainAccessSource ?? null,
          pathEdgeIds: company.pathEdgeIds ?? null,
          inheritedAccessPaths: company.inheritedAccessPaths ?? null,
        })),
      },
      endpoints: {
        agentSession: `${baseUrl}/api/agent/session`,
        agentWorkflowResolve: `${baseUrl}/api/agent/workflow/resolve`,
        agentContextPack: `${baseUrl}/api/agent/context-pack`,
        agentContextPackTemplate: `${baseUrl}/api/agent/context-pack?company_id={company_id}&intent={intent}&query={query}`,
        agentCompanies: `${baseUrl}/api/agent/companies`,
        agentCompaniesResolveTemplate: `${baseUrl}/api/agent/companies?query={query}&requested_domain={domain}`,
        agentCompanyMembers: `${baseUrl}/api/agent/company-members`,
        agentProfile: `${baseUrl}/api/agent/profile`,
        agentSettings: `${baseUrl}/api/agent/settings`,
        agentDashboard: `${baseUrl}/api/agent/dashboard`,
        agentReportJobs: `${baseUrl}/api/agent/report-jobs`,
        agentPeople: `${baseUrl}/api/agent/people`,
        agentConnectors: `${baseUrl}/api/agent/connectors`,
        agentMcp: `${baseUrl}/api/agent/mcp`,
        routineTemplates: `${baseUrl}/api/routines/templates`,
        routines: `${baseUrl}/api/routines`,
        routineDetailTemplate: `${baseUrl}/api/routines/{routineId}`,
        routineManifestTemplate: `${baseUrl}/api/routines/{routineId}/manifest`,
        routineManifestSourceTestTemplate: `${baseUrl}/api/routines/{routineId}/manifest/sources/{sourceId}/test`,
        routineScheduleTemplate: `${baseUrl}/api/routines/{routineId}/schedule`,
        routineRunTemplate: `${baseUrl}/api/routines/{routineId}/run`,
        routineBackfillTemplate: `${baseUrl}/api/routines/{routineId}/backfill`,
        routineRunsTemplate: `${baseUrl}/api/routines/{routineId}/runs`,
        routineRunDetailTemplate: `${baseUrl}/api/routines/{routineId}/runs/{runId}`,
        routineReportJobsTemplate: `${baseUrl}/api/routines/{routineId}/report-jobs`,
        routineReportArtifactTemplate: `${baseUrl}/api/routines/{routineId}/report-jobs/{jobId}/artifacts/{artifactId}`,
        routineReportArtifactDownloadTemplate: `${baseUrl}/api/routines/{routineId}/report-jobs/{jobId}/artifacts/{artifactId}?download=1`,
        routineObservationsTemplate: `${baseUrl}/api/routines/{routineId}/observations`,
        routineObservationsForRunTemplate: `${baseUrl}/api/routines/{routineId}/observations?runId={runId}`,
        routineSourcesTemplate: `${baseUrl}/api/routines/{routineId}/sources`,
        routineSourceDetailTemplate: `${baseUrl}/api/routines/{routineId}/sources/{sourceId}`,
        routineSourceTestTemplate: `${baseUrl}/api/routines/{routineId}/sources/{sourceId}/test`,
        routineCandidatesTemplate: `${baseUrl}/api/routines/{routineId}/candidates`,
        routineCandidateDetailTemplate: `${baseUrl}/api/routines/{routineId}/candidates/{candidateId}`,
        routineDigestsTemplate: `${baseUrl}/api/routines/{routineId}/digests`,
        routineDigestPreviewTemplate: `${baseUrl}/api/routines/{routineId}/digests/preview`,
        companyQuery: `${baseUrl}/api/company/query`,
        companySearch: `${baseUrl}/api/company/search`,
        companyEntity: `${baseUrl}/api/company/entity`,
        companyFile: `${baseUrl}/api/company/file`,
        companyMcp: `${baseUrl}/api/company/mcp`,
        connectorsHub: `${baseUrl}/api/connectors/hub`,
        connectorsHubLegacy: `${baseUrl}/api/connectors/hub`,
        documents: `${baseUrl}/api/documents`,
        documentsUpload: `${baseUrl}/api/documents/upload`,
        documentsBatchUpload: `${baseUrl}/api/documents/batch-upload`,
        documentQuestions: `${baseUrl}/api/documents/questions`,
        documentQuestionsTemplate: `${baseUrl}/api/documents/{documentId}/clarifications`,
      },
      documentWorkflow: {
        uploadMetadata: {
          multipartFields: [
            "metadata",
            "sourceContext",
            "sourceProvider",
            "sourcePath",
            "rootPath",
            "connectionLabel",
            "sourceUrl",
            "externalDocumentId",
            "agentNotes",
            "clarificationAnswers",
          ],
          clarificationAnswerKeys: [
            "currency",
            "entity",
            "book",
            "report_type",
            "target_domain",
            "period_label",
            "pnl_sheet_name",
            "balance_sheet_sheet_name",
            "cash_flow_sheet_name",
            "projection_sheet_name",
            "metrics_sheet_name",
          ],
        },
        questionQueue: "GET /api/documents/questions",
        answerQuestions: "POST /api/documents/{documentId}/clarifications",
      },
      automationWorkflow: {
        templates: [
          "legal_watch_bkpm",
          "daily_finance_report",
          "weekly_operating_report",
          "monthly_management_report",
        ],
        scopes: {
          read: ["routines.read", "routines.write", "routines.review", "*"],
          write: ["routines.write", "*"],
          review: ["routines.review", "*"],
          sourceTests: ["routines.write", "company_db.read", "documents.read", "connectors.use.odoo"],
        },
        examples: {
          createWeeklyReport: {
            method: "POST",
            path: "/api/routines",
            body: {
              templateKey: "weekly_operating_report",
              title: "Weekly operating report",
              createMode: "new",
              schedulePolicy: {
                cadence: "weekly",
                timezone: "UTC",
                localAnchor: { dayOfWeek: 1, hour: 0, minute: 0 },
                dueTime: { hour: 9, minute: 0 },
                dueOffsetDays: 0,
                catchUpPolicy: "last_due_only",
                maxBackfillWindowCount: 8,
                manualRunEnabled: true,
                schedulerEnabled: false,
              },
              sourcePolicy: {
                sourceStatusModel: "available_partial_unavailable_failed",
                configuredSourcesRequiredBeforeActivation: false,
                builtInSources: ["company_db", "odoo", "documents"],
                maxItemsPerSource: 50,
              },
              reviewPolicy: {
                reviewRequired: true,
                mode: "human_or_scoped_api_key",
                publishPolicy: "review_required",
              },
              digestPolicy: {
                previewOnly: true,
                delivery: "disabled",
                artifactFormats: ["markdown", "xlsx"],
              },
            },
          },
          runAndPoll: {
            start: "POST /api/routines/{routineId}/run",
            pollRun: "GET /api/routines/{routineId}/runs/{runId}",
            listReportJobs: "GET /api/routines/{routineId}/report-jobs",
          },
          backfill: {
            preview: {
              method: "POST",
              path: "/api/routines/{routineId}/backfill",
              body: { latestDue: true, dryRun: true, maxWindowCount: 1 },
            },
            queue: {
              method: "POST",
              path: "/api/routines/{routineId}/backfill",
              body: { latestDue: true, dryRun: false, confirm: true, maxWindowCount: 1 },
            },
          },
          reviewArtifact: {
            approve: {
              method: "PATCH",
              path: "/api/routines/{routineId}/report-jobs/{jobId}/artifacts/{artifactId}",
              body: { action: "approve" },
            },
            reject: {
              method: "PATCH",
              path: "/api/routines/{routineId}/report-jobs/{jobId}/artifacts/{artifactId}",
              body: { action: "reject", reviewReason: "Missing evidence" },
            },
          },
        },
        statusTransitions: {
          routine: ["draft", "paused", "active", "archived"],
          run: ["queued", "running", "completed", "completed_with_errors", "failed", "cancelled"],
          reportArtifact: ["pending", "approving", "approved", "rejected"],
        },
      },
      guidance: {
        navigationOrder: [
          "Start with /api/agent/session exactly once per run to discover company access, endpoints, and workflow hints.",
          "If the task is non-trivial, call /api/agent/workflow/resolve or resolve_workflow next so the platform chooses the primary path instead of guessing.",
          "For high-stakes finance, legal, tax, governance, operating-entity, or source-system work, fetch /api/agent/context-pack or call get_context_pack after workflow resolution and before answering or acting. Treat it as guidance and source-map context, not as a replacement for live Company-DB, report-job, or connector checks.",
          "If the key or MCP session can access multiple companies, resolve the target company first before calling connector, document, or Company-DB tools. Use /api/agent/companies?query=... with requested_domain/requested_connector_scope for a lightweight scope check, or pass company_id as the company UUID when available; slug or exact company name are accepted as fallbacks.",
          "When /api/agent/companies returns operatingEntityMatches, their aliases, companyDbSearchTerms, connectorSearchHints, and sourceMappings are search hints only. They do not grant tenant, domain, or connector access.",
          "For historical, imported, or document-backed company knowledge, including finance and revenue, use Company-DB before live connectors.",
          "Use /api/agent/connectors only when the user explicitly asks for live or source-system data, or when Company-DB does not contain enough evidence.",
          "For explicit live ERP finance work, create a report job before attempting any raw Odoo or ERP pagination.",
          "After creating a report job, keep polling it with the bounded wait path until it finishes or the wait window times out.",
          "Use Company-DB for compact summaries, historical finance evidence, cross-checks, and drill-down.",
          "Use open_company_app only when a human needs to open Corpus directly; do not use it as the primary machine retrieval path.",
        ],
        connectorDiscipline: [
          "Before claiming Slack, Jira, BambooHR, Confluence, Microsoft, Dynamics, Payhawk, Zendesk, Telegram, Google Drive, LinkedIn MCP, Custom MCP, or Metabase are unavailable for a live/source-system request, call /api/agent/connectors GET first.",
          "If a connector is active, call /api/agent/connectors POST before asking the user for exports or screenshots.",
          "If a connector query returns zero records, report zero records for that query instead of claiming the integration is missing.",
          "If live financial connectors are absent, do not claim there is no finance data; search Company-DB next.",
          "On the ChatGPT employee surface, do not use generic Odoo connector calls for finance work; use direct_odoo_lookup only for explicit narrow live lookups.",
          "For custom MCP connectors, list the allowlisted tools first and then call the exact read-only tool by name.",
        ],
        slackWorkflow: [
          "Typical Slack flow: list connectors, then use slack.search_all or slack.list_channels, then drill down with slack.get_channel_history or slack.get_thread_replies.",
        ],
        reportWorkflow: [
          "For complex monthly or multi-step finance questions, prefer /api/agent/report-jobs over long inline Odoo loops.",
          "For recurring source-backed reports, discover /api/routines/templates, create or inspect /api/routines, start runs with /api/routines/{routineId}/run, then poll /api/routines/{routineId}/runs/{runId}.",
          "Routine report job list and run-detail responses are compact status surfaces. Fetch a specific routine report artifact path only when previewing, downloading, approving, or rejecting that artifact.",
          "If the user did not explicitly ask for live ERP or source-system data, Company-DB remains the primary historical source even for finance questions.",
          "On the ChatGPT employee surface, report-scale finance requests should be routed into report jobs, while direct_odoo_lookup is reserved for explicit narrow live Odoo lookups.",
          "Create the report job first, then use bounded polling until it finishes and fetch the artifact once the worker is done.",
          "The current executor supports whole-company finance plus deterministic Odoo line-level F&B and multimedia requests, including venue and department segmentation when Odoo provides a stable anchor.",
          "If the current executor still cannot map a requested segment, report the explicit fallback bucket such as Unmapped venue instead of guessing finance totals.",
        ],
        documentWorkflow: [
          "When uploading a document as an external agent, include sourceContext or metadata plus agentNotes when you know where the file came from.",
          "If you already know answers such as currency, entity, period, report_type, target_domain, or workbook sheet roles, send them as clarificationAnswers in the upload request.",
          "After upload, check agentWorkflow.questionsUrl for that document or poll /api/documents/questions to see Document Questions that still need answers.",
          "Answer Document Questions with POST /api/documents/{documentId}/clarifications and set reprocess=true unless you intentionally only want to save the answer.",
        ],
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
