import { z } from "zod";

export const reportJobStatusSchema = z.enum([
  "planning",
  "planned",
  "queued",
  "running",
  "awaiting_clarification",
  "completed",
  "failed",
  "cancelled",
]);
export type ReportJobStatus = z.infer<typeof reportJobStatusSchema>;

export const reportOutputFormatSchema = z.enum(["markdown", "docx", "xlsx"]);
export type ReportOutputFormat = z.infer<typeof reportOutputFormatSchema>;

export const reportStrictnessSchema = z.enum(["standard", "strict"]);
export type ReportStrictness = z.infer<typeof reportStrictnessSchema>;

export const reportFamilySchema = z.enum([
  "financial_analysis",
  "revenue_report",
  "expense_report",
  "department_report",
  "variance_report",
  "cash_report",
  "custom_operational_report",
]);
export type ReportFamily = z.infer<typeof reportFamilySchema>;

export const reportPeriodSchema = z.object({
  kind: z.enum(["calendar_month", "calendar_quarter", "absolute_range", "relative_range", "unknown"]),
  label: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  preset: z.string().optional(),
  anchorDate: z.string().optional(),
  timezone: z.string().optional(),
});
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

export const reportOperatingScopeSchema = z.object({
  operatingEntityId: z.string(),
  canonicalName: z.string(),
  objectType: z.string(),
  grantsDataAccess: z.literal(false),
  searchTerms: z.array(z.string()).default([]),
  sourceMappings: z.object({
    companyDb: z.object({
      folders: z.array(z.string()).default([]),
      queryAliases: z.array(z.string()).default([]),
    }).default({ folders: [], queryAliases: [] }),
    odoo: z.object({
      company: z.string().nullable().default(null),
      analyticAccounts: z.array(z.string()).default([]),
      posConfigs: z.array(z.string()).default([]),
      accounts: z.array(z.string()).default([]),
      partners: z.array(z.string()).default([]),
    }).default({
      company: null,
      analyticAccounts: [],
      posConfigs: [],
      accounts: [],
      partners: [],
    }),
    customMcp: z.object({
      tools: z.array(z.string()).default([]),
    }).default({ tools: [] }),
  }).default({
    companyDb: { folders: [], queryAliases: [] },
    odoo: {
      company: null,
      analyticAccounts: [],
      posConfigs: [],
      accounts: [],
      partners: [],
    },
    customMcp: { tools: [] },
  }),
}).nullable().default(null);
export type ReportOperatingScope = z.infer<typeof reportOperatingScopeSchema>;

export const reportIntentSchema = z.object({
  request: z.string(),
  companyId: z.string(),
  reportFamily: reportFamilySchema,
  subject: z.string(),
  period: reportPeriodSchema,
  dimensions: z.array(z.string()).default([]),
  metrics: z.array(z.string()).default([]),
  filters: z.record(z.string(), z.unknown()).default({}),
  operatingScope: reportOperatingScopeSchema,
  outputFormat: reportOutputFormatSchema,
  strictness: reportStrictnessSchema,
  needsClarification: z.boolean(),
  clarificationQuestions: z.array(z.string()).default([]),
});
export type ReportIntent = z.infer<typeof reportIntentSchema>;

export const executionPlanStepSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "connector_query",
    "company_db_query",
    "document_lookup",
    "aggregation",
    "cross_check",
    "artifact_render",
  ]),
  source: z.string().optional(),
  description: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type ExecutionPlanStep = z.infer<typeof executionPlanStepSchema>;

export const executionPlanDraftSchema = z.object({
  version: z.number().int().min(1),
  companyId: z.string(),
  planStatus: z.enum(["ready", "needs_clarification", "rejected"]),
  sources: z.array(z.string()).default([]),
  steps: z.array(executionPlanStepSchema).default([]),
  evidencePolicy: z.object({
    includeTopRecords: z.boolean().default(true),
    maxEvidenceItems: z.number().int().min(1).default(20),
  }),
  renderPolicy: z.object({
    outputFormat: reportOutputFormatSchema,
    titleHint: z.string(),
  }),
  timeoutBudgetMs: z.number().int().min(1),
});
export type ExecutionPlanDraft = z.infer<typeof executionPlanDraftSchema>;

export const reportJobSummarySchema = z.object({
  phase: z.enum(["planning", "planned", "clarification_needed", "execution", "completed", "failed", "cancelled"]),
  summary: z.string(),
  nextAction: z.string().optional(),
  clarificationQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
  metricsSnapshot: z.record(z.string(), z.unknown()).default({}),
  artifactCount: z.number().int().min(0).default(0),
  reusedExistingJob: z.boolean().default(false),
});
export type ReportJobSummary = z.infer<typeof reportJobSummarySchema>;

export const reportJobArtifactRecordSchema = z.object({
  id: z.string(),
  reportJobId: z.string(),
  companyId: z.string(),
  kind: z.string(),
  fileName: z.string(),
  mimeType: z.string().nullable(),
  downloadPath: z.string().nullable(),
  viewPath: z.string().nullable(),
  reviewStatus: z.enum(["pending", "approving", "approved", "rejected"]).default("pending"),
  reviewedBy: z.string().nullable().default(null),
  reviewedAt: z.date().nullable().default(null),
  reviewReason: z.string().nullable().default(null),
  publishedBy: z.string().nullable().default(null),
  publishedAt: z.date().nullable().default(null),
  publishedTargetDomain: z.string().nullable().default(null),
  publishedTargetPath: z.string().nullable().default(null),
  commitSha: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
});
export type ReportJobArtifactRecord = z.infer<typeof reportJobArtifactRecordSchema>;

export const reportJobRecordSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  routineRunId: z.string().nullable(),
  requestedByUserId: z.string(),
  status: reportJobStatusSchema,
  requestText: z.string(),
  requestFingerprint: z.string(),
  plannerVersion: z.number().int(),
  outputFormat: reportOutputFormatSchema,
  strictness: reportStrictnessSchema,
  intent: reportIntentSchema,
  executionPlan: executionPlanDraftSchema.nullable(),
  executionContext: z.record(z.string(), z.unknown()),
  resultSummary: reportJobSummarySchema,
  error: z.string().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ReportJobRecord = z.infer<typeof reportJobRecordSchema>;

export const createReportJobInputSchema = z.object({
  companyId: z.string(),
  routineRunId: z.string().optional().nullable(),
  request: z.string().trim().min(1),
  outputFormat: reportOutputFormatSchema.optional(),
  strictness: reportStrictnessSchema.optional(),
});
export type CreateReportJobInput = z.infer<typeof createReportJobInputSchema>;
