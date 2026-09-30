/**
 * Onboarding tool definitions for the Anthropic / AI SDK chat route.
 *
 * Each entry is an `ai`-SDK `tool({...})` factory: description + zod
 * inputSchema + execute. The execute closure receives an
 * OnboardingExecutionContext that the chat route builds per-request
 * (threadId, companyId, userId, db, etc.). Wiring lives in the route
 * itself; this module is pure declarative data so it can be tested in
 * isolation and so the system prompt can include the catalog.
 */

import { tool } from "ai";
import { z } from "zod";

import {
  ONBOARDING_TOOLS,
  type BotProgress,
  type OnboardingCompanyState,
} from "./types";

/**
 * Context the chat route assembles for each onboarding tool call. The
 * handler implementations consume this; the tool factory closes over it.
 *
 * This is a hook seam — tests can pass a stub implementation to verify
 * handler behavior without spinning up a database.
 */
export interface OnboardingExecutionContext {
  threadId: string;
  companyId: string;
  userId: string;
  markFieldPrompted(field: string): Promise<BotProgress>;
  setStarterQuestionsOffered(): Promise<BotProgress>;
  setDocumentsRequested(): Promise<BotProgress>;
  setConnectorsRequested(): Promise<BotProgress>;
  setFounderRolePrompted(): Promise<BotProgress>;
  setCompanyType(companyType: string): Promise<OnboardingCompanyState>;
  setFirstWorkflow(firstWorkflow: string): Promise<OnboardingCompanyState>;
  setActingAs(actingAs: "self" | "assistant"): Promise<OnboardingCompanyState>;
  saveProfileField(field: string, value: string): Promise<void>;
  recordHandoff(): Promise<OnboardingCompanyState>;
  releaseResumePointer(): Promise<void>;
  getSnapshotSummary(): Promise<{
    companyName: string | null;
    completedFields: number;
    totalFields: number;
    requiredComplete: boolean;
    documentsUploaded: number;
    connectorsLinked: string[];
  }>;
}

/* ─── input schemas (exported so handlers + tests stay in sync) ──── */

export const ProfileFormInputSchema = z.object({
  fields: z
    .array(z.enum(["companyName", "founderRole", "primaryQuestion"]))
    .min(1)
    .max(3)
    .describe(
      "Which canonical profile fields to render in this form. Use only fields the bot is supposed to ASK (not ones inferable from docs).",
    ),
  copy: z
    .string()
    .min(1)
    .max(280)
    .describe(
      "Short conversational prompt above the form. Tone: peer-to-CFO, not concierge.",
    ),
});

export const DocumentDropzoneInputSchema = z.object({
  copy: z
    .string()
    .min(1)
    .max(280)
    .describe(
      "Short prompt above the dropzone, e.g. 'Drop anything you'd hand a real CFO — P&L, bank statements, contracts'.",
    ),
  acceptedKinds: z
    .array(
      z.enum(["pdf", "xlsx", "csv", "docx", "image"]),
    )
    .min(1)
    .default(["pdf", "xlsx", "csv", "docx", "image"]),
});

export const ConnectorCardInputSchema = z.object({
  provider: z
    .enum([
      "stripe",
      "truelayer",
      "slack",
      "google_drive",
    ])
    .describe("Connector provider identifier. Must be one of the four verified OAuth slugs."),
  copy: z.string().min(1).max(280),
  trustNote: z
    .string()
    .max(200)
    .optional()
    .describe(
      "One-line clarification of what this connector reads. Surfaces as a collapsible affordance.",
    ),
});

export const StarterQuestionsInputSchema = z.object({
  copy: z.string().min(1).max(280).default(
    "What do you want me to answer first?",
  ),
});

export const CompanyTypeChoiceInputSchema = z.object({
  copy: z.string().min(1).max(280),
});

export const FirstWorkflowChoiceInputSchema = z.object({
  copy: z.string().min(1).max(280),
});

export const SaveProfileFieldInputSchema = z.object({
  field: z
    .enum([
      "companyName",
      "founderRole",
      "primaryQuestion",
      "jurisdiction",
      "entityType",
      "businessType",
      "website",
      "companyStage",
    ])
    .describe("Which canonical profile field to persist."),
  value: z
    .string()
    .min(1)
    .max(2000)
    .describe("The user's answer, cleaned to a concise value."),
});

export const GetSnapshotInputSchema = z.object({});

export const RecordSkipInputSchema = z.object({
  field: z
    .string()
    .describe(
      "Identifier of the prompt the user wants to skip. Use the same name the bot used (e.g. 'founderRole', 'documentDropzone', 'connectorCard').",
    ),
});

export const CompleteAndHandoffInputSchema = z.object({
  goodbyeCopy: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "The closing message the bot writes. Should include a summary of what's known + invite the user's first real question.",
    ),
});

/**
 * Builds the full onboarding tool catalog wired to a per-request context.
 * Returns a record keyed by tool name so the route can spread it into its
 * `tools: { ...buildOnboardingToolset(ctx) }` map.
 */
export function buildOnboardingToolset(ctx: OnboardingExecutionContext) {
  return {
    [ONBOARDING_TOOLS.SaveProfileField]: tool({
      description:
        "Persist a profile field the user just answered in free text (e.g. after they pick a starter question, save it as primaryQuestion; when they name their company, save companyName). Call this whenever the user gives a profile answer in chat — it's what stops the bot re-asking. Does NOT mark onboarding complete.",
      inputSchema: SaveProfileFieldInputSchema,
      execute: async (args) => {
        await ctx.saveProfileField(args.field, args.value);
        return { action: "profile_saved" as const, field: args.field };
      },
    }),

    [ONBOARDING_TOOLS.RenderProfileForm]: tool({
      description:
        "Render a profile form card for 1-3 fields the bot needs to ask. Use ONLY when the user hasn't yet given the field in chat and the bot has decided to prompt for it. Prefer text questions for single-field asks.",
      inputSchema: ProfileFormInputSchema,
      execute: async (args) => {
        for (const field of args.fields) {
          await ctx.markFieldPrompted(field);
        }
        return {
          action: "render_card" as const,
          card: "profile_form" as const,
          fields: args.fields,
          copy: args.copy,
        };
      },
    }),

    [ONBOARDING_TOOLS.RenderDocumentDropzone]: tool({
      description:
        "Render a multi-file dropzone for the user to drop financial docs (P&L, bank statements, contracts). The bot uses this EARLY — typically after the starter question is answered. Files are uploaded to /api/documents/upload with this thread linked.",
      inputSchema: DocumentDropzoneInputSchema,
      execute: async (args) => {
        await ctx.setDocumentsRequested();
        return {
          action: "render_card" as const,
          card: "document_dropzone" as const,
          copy: args.copy,
          acceptedKinds: args.acceptedKinds,
          threadId: ctx.threadId,
        };
      },
    }),

    [ONBOARDING_TOOLS.RenderConnectorCard]: tool({
      description:
        "Render a single connector card with provider OAuth flow. The card click takes the user through OAuth; on success the callback posts a system message back into this thread. Surface a one-line trustNote on first use.",
      inputSchema: ConnectorCardInputSchema,
      execute: async (args) => {
        await ctx.setConnectorsRequested();
        return {
          action: "render_card" as const,
          card: "connector_card" as const,
          provider: args.provider,
          copy: args.copy,
          trustNote: args.trustNote ?? null,
          threadId: ctx.threadId,
        };
      },
    }),

    [ONBOARDING_TOOLS.RenderStarterQuestions]: tool({
      description:
        "Render the value-first starter-question chip card (cash runway / last P&L / money leaks / open). Use as the bot's SECOND message after the welcome line, BEFORE any profile prompt. Inverts the script per UX review.",
      inputSchema: StarterQuestionsInputSchema,
      execute: async (args) => {
        await ctx.setStarterQuestionsOffered();
        return {
          action: "render_card" as const,
          card: "starter_questions" as const,
          copy: args.copy,
        };
      },
    }),

    [ONBOARDING_TOOLS.RenderCompanyTypeChoice]: tool({
      description:
        "Render a company-type choice card (single entity / multi-entity operator / holding / fractional CFO). Use ONLY if you cannot infer the type from the user's role answer or uploaded docs. Do not lead with this question.",
      inputSchema: CompanyTypeChoiceInputSchema,
      execute: async (args) => ({
        action: "render_card" as const,
        card: "company_type_choice" as const,
        copy: args.copy,
      }),
    }),

    [ONBOARDING_TOOLS.RenderFirstWorkflowChoice]: tool({
      description:
        "Render the first-workflow choice card (morning brief / board pack / data room / customMcp). Use at the handoff moment as one of the two paths the user can pick.",
      inputSchema: FirstWorkflowChoiceInputSchema,
      execute: async (args) => ({
        action: "render_card" as const,
        card: "first_workflow_choice" as const,
        copy: args.copy,
      }),
    }),

    [ONBOARDING_TOOLS.GetSnapshot]: tool({
      description:
        "Return a compact snapshot of where the user is in onboarding (profile completion, documents uploaded, connectors linked). Call this at the HANDOFF DECISION point only, not every turn — the system prompt already carries the next-step priority.",
      inputSchema: GetSnapshotInputSchema,
      execute: async () => {
        const summary = await ctx.getSnapshotSummary();
        return {
          action: "snapshot" as const,
          ...summary,
        };
      },
    }),

    [ONBOARDING_TOOLS.RecordSkip]: tool({
      description:
        "Record that the user wants to skip a particular prompt (e.g. 'founderRole', 'documentDropzone'). Prevents the bot from looping. Use whenever the user says 'skip', 'later', 'not now'.",
      inputSchema: RecordSkipInputSchema,
      execute: async (args) => {
        await ctx.markFieldPrompted(args.field);
        return { action: "skip_recorded" as const, field: args.field };
      },
    }),

    [ONBOARDING_TOOLS.CompleteAndHandoff]: tool({
      description:
        "Perform the final onboarding handoff. Stamps the handoff timestamp on the company onboarding state, clears the user's resume pointer, and emits the goodbye message that transitions the chat to ordinary CFO mode.",
      inputSchema: CompleteAndHandoffInputSchema,
      execute: async (args) => {
        await ctx.recordHandoff();
        await ctx.releaseResumePointer();
        return {
          action: "handoff_complete" as const,
          goodbyeCopy: args.goodbyeCopy,
        };
      },
    }),
  };
}
