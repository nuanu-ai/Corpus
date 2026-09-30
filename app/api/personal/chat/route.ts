import { anthropic } from "@ai-sdk/anthropic";
import {
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  getSessionPersonalProjectContext,
  handleApiError,
} from "@/lib/api-auth";
import {
  createConsultantExportFile,
  getConsultantExportMimeType,
  type ConsultantExportFormat,
} from "@/lib/consultant/exports";
import {
  MAX_CONSULTANT_THREAD_HISTORY_MESSAGES,
  applyTailCacheBreakpoint,
  convertConsultantMessagesForModel,
} from "@/lib/consultant/messages";
import { syncNormalizedThreadMessages } from "@/lib/consultant/store";
import {
  ensureConsultantThreadWorkspace,
  writeConsultantArtifactFile,
} from "@/lib/consultant/workspace";
import {
  buildPersonalChatContext,
  buildPersonalChatSystemPrompt,
} from "@/lib/consultant/personal-chat";
import { db } from "@/lib/db";
import { ensureCompanyProvisioned } from "@/lib/company-db/provisioning";
import { checkChatRunQuota } from "@/lib/auth/usage-limits";
import { chatArtifacts, chatRuns, chatThreads } from "@/lib/db/schema";
import {
  estimateChatRunCostUsd,
  normalizeChatRunUsage,
  summarizeLatestUserPrompt,
} from "@/lib/consultant/chat-run-usage";
import { recordLlmUsageEvent } from "@/lib/llm-usage-events";
import { compressOversizedImages } from "@/lib/chat/validate-attachments";

const MAX_CONSULTANT_ARTIFACT_CONTENT_CHARS = 1_000_000;
const MODEL_ID = "claude-sonnet-4-6";

const messagesSchema = z.object({
  id: z.string().optional(),
  threadId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        parts: z.array(z.any()),
      }),
    )
    .max(MAX_CONSULTANT_THREAD_HISTORY_MESSAGES),
});

const exportCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const consultantExportSchema = z.object({
  title: z.string().trim().min(1).max(160),
  format: z.enum(["xlsx", "csv", "tsv"]),
  fileName: z.string().trim().min(1).max(180).optional(),
  sheets: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(31).optional(),
        columns: z.array(z.string().trim().min(1).max(120)).optional(),
        rows: z.array(z.record(z.string(), exportCellSchema)).max(5000),
      }),
    )
    .min(1)
    .max(8),
});

export async function POST(req: Request) {
  let body: { messages: UIMessage[]; id?: string; threadId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = messagesSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid request: messages array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const compressionSummary = await compressOversizedImages(parsed.data.messages);
  if (compressionSummary.rewritten > 0 || compressionSummary.failures > 0) {
    console.log(
      `[personal-chat] image compression: rewritten=${compressionSummary.rewritten} failures=${compressionSummary.failures} ` +
        `${(compressionSummary.originalBase64Bytes / 1024 / 1024).toFixed(2)}MB -> ${(compressionSummary.compressedBase64Bytes / 1024 / 1024).toFixed(2)}MB (base64)`,
    );
  }
  if (compressionSummary.failures > 0) {
    return new Response(
      JSON.stringify({
        error: "Image attachment is too large and could not be downscaled. Please attach a smaller image.",
        reason: "image_too_large",
      }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    );
  }

  const messages = (parsed.data.messages as UIMessage[]).filter(
    (message) => message.id !== "greeting",
  );
  // See company chat route for rationale: reject non-UUID thread ids so the
  // UUID column insert doesn't blow up downstream.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawThreadId =
    typeof body.threadId === "string" && body.threadId.trim().length > 0
      ? body.threadId.trim()
      : typeof body.id === "string" && body.id.trim().length > 0
        ? body.id.trim()
        : null;
  const threadId = rawThreadId && UUID_RE.test(rawThreadId) ? rawThreadId : null;

  if (!threadId) {
    return new Response(
      JSON.stringify({ error: "threadId is required for personal chat" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "Anthropic API key is not configured. Set ANTHROPIC_API_KEY in your environment to enable personal chat.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const auth = await getSessionPersonalProjectContext();
    const companyId = auth.projectId;
    const userId = auth.userId;

    // Daily chat quota for tier='community' (no-op for managed accounts).
    const quota = await checkChatRunQuota(userId);
    if (!quota.ok) {
      return Response.json(
        {
          error: quota.message,
          reason: quota.reason,
          used: quota.used,
          limit: quota.limit,
          resetAt: quota.resetAt,
        },
        { status: 429 },
      );
    }

    // Lazy-provision (community-tier signups land here pending; no-op for active).
    try {
      await ensureCompanyProvisioned(companyId);
    } catch (provisionErr) {
      console.error(
        `[personal-chat] Lazy provisioning failed for projectId=${companyId}:`,
        provisionErr,
      );
    }

    const [thread] = await db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        createdAt: chatThreads.createdAt,
        updatedAt: chatThreads.updatedAt,
      })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, threadId),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
        ),
      )
      .limit(1);

    if (!thread) {
      return new Response(JSON.stringify({ error: "Thread not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const latestUserPromptSummary = summarizeLatestUserPrompt(messages);
    const personalContext = await buildPersonalChatContext({
      tenantId: companyId,
      userId,
      role: auth.role,
    });
    const systemPrompt = buildPersonalChatSystemPrompt(personalContext);

    // DATA-1: onConflictDoNothing guards the race window between SELECT-then-INSERT
    // for the chat_runs_active_thread_uniq partial index (status in queued|running).
    const inserted = await db
      .insert(chatRuns)
      .values({
        threadId,
        companyId,
        uiMessageId: messages.at(-1)?.id ?? null,
        provider: "anthropic",
        model: MODEL_ID,
        executor: "personal_chat_route",
        status: "running",
        summary: latestUserPromptSummary,
        metadata: {
          userId,
          tenantKind: "person",
          surface: "personal",
          latestUserPromptSummary,
        },
        startedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: chatRuns.id });
    const chatRunId: string | null = inserted[0]?.id ?? null;

    async function updateChatRunStatus(
      status: "completed" | "failed",
      patch: { metadata?: Record<string, unknown>; summary?: string | null } = {},
    ) {
      if (!chatRunId) return;

      try {
        const values: Record<string, unknown> = {
          status,
          completedAt: new Date(),
        };
        if (patch.summary !== undefined) values.summary = patch.summary;
        if (patch.metadata) values.metadata = patch.metadata;
        await db.update(chatRuns).set(values).where(eq(chatRuns.id, chatRunId));
      } catch (error) {
        console.warn("Failed to update personal chat run telemetry row", error);
      }
    }

    let result;
    try {
      result = streamText({
        model: anthropic(MODEL_ID),
        maxOutputTokens: 4096,
        // Cache the system prompt (see company chat route for rationale).
        system: {
          role: "system",
          content: systemPrompt,
          providerOptions: {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          },
        },
        messages: applyTailCacheBreakpoint(
          await convertConsultantMessagesForModel(messages),
        ),
        stopWhen: stepCountIs(4),
        onAbort: async ({ steps }) => {
          await updateChatRunStatus("failed", {
            metadata: {
              userId,
              tenantKind: "person",
              surface: "personal",
              latestUserPromptSummary,
              finishReason: "aborted",
              steps: steps.length,
            },
          });
        },
        onError: async ({ error }) => {
          await updateChatRunStatus("failed", {
            metadata: {
              userId,
              tenantKind: "person",
              surface: "personal",
              latestUserPromptSummary,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        },
        onFinish: async ({ text, finishReason, totalUsage, steps }) => {
          const usage = normalizeChatRunUsage(totalUsage);
          const estimatedCostUsd = estimateChatRunCostUsd({
            provider: "anthropic",
            model: MODEL_ID,
            usage,
          });
          const assistantSummary = text.trim().replace(/\s+/g, " ");

          await updateChatRunStatus("completed", {
            summary:
              assistantSummary.length > 0
                ? assistantSummary.slice(0, 280)
                : latestUserPromptSummary,
            metadata: {
              userId,
              tenantKind: "person",
              surface: "personal",
              latestUserPromptSummary,
              finishReason,
              steps: steps.length,
              usage,
              estimatedCostUsd,
            },
          });

          if (usage) {
            try {
              await recordLlmUsageEvent({
                companyId,
                userId,
                provider: "anthropic",
                model: MODEL_ID,
                subsystem: "chat_consultant",
                operation: "personal_chat_response",
                executor: "personal_chat_route",
                billingMode: "api",
                threadId,
                usage,
                estimatedCostUsd,
                metadata: {
                  tenantKind: "person",
                  surface: "personal",
                  finishReason,
                  steps: steps.length,
                },
              });
            } catch (error) {
              console.warn("Failed to record personal chat usage event", error);
            }
          }

          // Persist conversation history (see company chat route for rationale).
          try {
            const assistantMessage = text.trim().length > 0
              ? {
                  id: `asst-${Date.now().toString(36)}`,
                  role: "assistant" as const,
                  parts: [{ type: "text" as const, text }],
                }
              : null;
            const fullHistory = assistantMessage
              ? [...messages, assistantMessage]
              : messages;
            const trimmedHistory = fullHistory.slice(
              -MAX_CONSULTANT_THREAD_HISTORY_MESSAGES,
            );

            const maybeAutoTitle = (() => {
              const firstUser = trimmedHistory.find(
                (m) => m && (m as { role?: string }).role === "user",
              ) as { parts?: Array<{ type?: string; text?: string }> } | undefined;
              const firstText = firstUser?.parts?.find(
                (p) => p?.type === "text",
              )?.text;
              if (!firstText) return null;
              const normalized = firstText.replace(/\s+/g, " ").trim();
              if (normalized.length === 0) return null;
              return normalized.length > 60
                ? `${normalized.slice(0, 57)}…`
                : normalized;
            })();

            await db.transaction(async (tx) => {
              await tx
                .update(chatThreads)
                .set({
                  messages: trimmedHistory as unknown as Array<
                    Record<string, unknown>
                  >,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(chatThreads.id, threadId),
                    eq(chatThreads.companyId, companyId),
                    eq(chatThreads.userId, userId),
                  ),
                );
              if (maybeAutoTitle) {
                await tx
                  .update(chatThreads)
                  .set({ title: maybeAutoTitle })
                  .where(
                    and(
                      eq(chatThreads.id, threadId),
                      eq(chatThreads.companyId, companyId),
                      eq(chatThreads.userId, userId),
                      eq(chatThreads.title, "New chat"),
                    ),
                  );
              }
              await syncNormalizedThreadMessages(tx, {
                threadId,
                companyId,
                userId,
                messages: trimmedHistory,
              });
            });
          } catch (error) {
            console.warn("Failed to persist personal chat history", error);
          }
        },
        tools: {
        // Anthropic-native web search. Available to personal copilot too —
        // useful for ad-hoc fact-checks while drafting personal notes.
        // Cast: provider tools don't fit the AI SDK's narrowed ToolSet shape.
        web_search: anthropic.tools.webSearch_20250305({
          maxUses: 5,
        }) as unknown as ReturnType<typeof tool>,
        create_consultant_artifact: tool({
          description:
            "Create a draft file in the current personal consultant thread workspace. Use this for notes, plans, memos, checklists, or other durable personal artifacts.",
          inputSchema: z.object({
            title: z.string().describe("Human-readable draft title"),
            kind: z.string().describe("Artifact kind, e.g. memo, plan, checklist, note"),
            content: z
              .string()
              .max(MAX_CONSULTANT_ARTIFACT_CONTENT_CHARS)
              .describe("Full file content to save"),
            fileName: z.string().optional().describe("Optional explicit file name with extension"),
            mimeType: z.string().optional().describe("Optional MIME type"),
          }),
          execute: async ({ title, kind, content, fileName, mimeType }) => {
            if (!threadId) {
              return {
                action: "artifact_created" as const,
                error: "Artifact creation requires a persisted thread context.",
              };
            }

            await ensureConsultantThreadWorkspace({
              companyId,
              threadId: thread.id,
              userId,
              title: thread.title,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
            });

            const file = await writeConsultantArtifactFile({
              companyId,
              threadId: thread.id,
              title,
              content,
              fileName,
              destination: "artifacts",
            });

            const [artifact] = await db
              .insert(chatArtifacts)
              .values({
                threadId: thread.id,
                companyId,
                kind,
                title,
                filePath: file.relativePath,
                mimeType: mimeType ?? null,
                status: "draft",
                metadata: {
                  rootPath: file.rootPath,
                  destination: "artifacts",
                },
              })
              .returning({
                id: chatArtifacts.id,
                kind: chatArtifacts.kind,
                title: chatArtifacts.title,
                filePath: chatArtifacts.filePath,
                mimeType: chatArtifacts.mimeType,
                status: chatArtifacts.status,
                createdAt: chatArtifacts.createdAt,
                updatedAt: chatArtifacts.updatedAt,
              });

            return {
              action: "artifact_created" as const,
              artifact: {
                ...artifact,
                createdAt: artifact.createdAt.toISOString(),
                updatedAt: artifact.updatedAt.toISOString(),
              },
            };
          },
        }),
        create_consultant_export: tool({
          description:
            "Create a spreadsheet or delimited export in the current personal consultant thread workspace when the user explicitly requests an export file.",
          inputSchema: consultantExportSchema,
          execute: async ({ title, format, fileName, sheets }) => {
            if (!threadId) {
              return {
                action: "artifact_created" as const,
                error: "Export creation requires a persisted thread context.",
              };
            }

            await ensureConsultantThreadWorkspace({
              companyId,
              threadId: thread.id,
              userId,
              title: thread.title,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
            });

            const file = await createConsultantExportFile({
              companyId,
              threadId: thread.id,
              title,
              format: format as ConsultantExportFormat,
              fileName,
              sheets,
            });

            const [artifact] = await db
              .insert(chatArtifacts)
              .values({
                threadId: thread.id,
                companyId,
                kind: "spreadsheet_export",
                title,
                filePath: file.relativePath,
                mimeType: getConsultantExportMimeType(format as ConsultantExportFormat),
                status: "draft",
                metadata: {
                  rootPath: file.rootPath,
                  destination: "exports",
                  format,
                  sheetCount: file.sheetCount,
                  sourceSheetCount: file.sourceSheetCount,
                  generatedSheetCount: file.generatedSheetCount,
                  rowCount: file.rowCount,
                  features: file.features,
                },
              })
              .returning({
                id: chatArtifacts.id,
                kind: chatArtifacts.kind,
                title: chatArtifacts.title,
                filePath: chatArtifacts.filePath,
                mimeType: chatArtifacts.mimeType,
                status: chatArtifacts.status,
                createdAt: chatArtifacts.createdAt,
                updatedAt: chatArtifacts.updatedAt,
              });

            return {
              action: "artifact_created" as const,
              artifact: {
                ...artifact,
                createdAt: artifact.createdAt.toISOString(),
                updatedAt: artifact.updatedAt.toISOString(),
              },
            };
          },
        }),
        },
      });
    } catch (streamError) {
      const message =
        streamError instanceof Error ? streamError.message : String(streamError);

      await updateChatRunStatus("failed", {
        metadata: {
          userId,
          tenantKind: "person",
          surface: "personal",
          latestUserPromptSummary,
          error: message,
        },
      });

      if (
        message.includes("API key") ||
        message.includes("authentication") ||
        message.includes("401") ||
        message.includes("Invalid")
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Anthropic API key is missing or invalid. Check your ANTHROPIC_API_KEY environment variable.",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      console.error("Personal AI streaming error:", streamError);
      return new Response(
        JSON.stringify({
          error: "Failed to connect to the AI service. Please try again.",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return result.toUIMessageStreamResponse();
  } catch (error) {
    return handleApiError(error);
  }
}
