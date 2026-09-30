import { randomUUID } from "crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  queryAllEntities,
  queryEntities,
  readQmdFile,
  submitCommunicationsCommit,
} from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { parseQmd } from "@/lib/company-db/summary/qmd";
import {
  COMMITMENT_NOTIFICATION_TYPES,
  extractCommitmentNotificationReference,
  buildCommitmentNotificationReference,
} from "@/lib/communications/commitment-notifications";
import { findCommitmentLifecycleResolutions } from "@/lib/communications/commitment-lifecycle";
import { toCommitmentSignalCandidate } from "@/lib/communications/commitments";
import {
  applyCommitmentLifecycleToSignalQmd,
  buildApprovedSignalImportFile,
  buildCommunicationContextFile,
  buildCommunicationDailyLogFile,
  buildCommunicationSignalFile,
  buildContactFile,
  buildThreadSlug,
} from "@/lib/communications/qmd";
import { deriveSenderContacts } from "@/lib/communications/people";
import { resolveMergedPeopleProfileTarget } from "@/lib/communications/profile-routing";
import {
  getCommunicationSynthesisModel,
  runCommunicationSynthesis,
  splitSignalsByApproval,
} from "@/lib/communications/synthesis";
import {
  estimateAnthropicUsageCostUsd,
  normalizeLlmUsage,
  recordLlmUsageEvent,
} from "@/lib/llm-usage-events";
import {
  claimCommunicationBatch,
  insertPendingSignals,
  listPendingCommunicationBatches,
  loadCommunicationMessagesByIds,
  markCommunicationBatchFailed,
  markCommunicationBatchProcessed,
} from "@/lib/communications/store";
import type { CommunicationBatch } from "@/lib/communications/types";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export interface PendingCommunicationSynthesisFilter {
  companyId?: string;
  provider?: string;
  limit?: number;
}

export async function listFilteredPendingCommunicationBatches(
  filter: PendingCommunicationSynthesisFilter = {},
): Promise<CommunicationBatch[]> {
  const batches = await listPendingCommunicationBatches(filter.limit ?? 50);
  return batches.filter((batch) => {
    if (filter.companyId && batch.companyId !== filter.companyId) return false;
    if (filter.provider && batch.provider !== filter.provider) return false;
    return true;
  });
}

function frontmatterString(value: unknown, maxLength = 500): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : "";
}

function frontmatterStringArray(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = frontmatterString(item, 160);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next;
}

export async function resolveContactProfileWriteTarget(input: {
  companySlug: string;
  companyDbPort: number;
  filePath: string;
}): Promise<{
  filePath: string;
  existing: { frontmatter: Record<string, unknown>; body: string } | null;
}> {
  return resolveMergedPeopleProfileTarget({
    filePath: input.filePath,
    loadFile: (filePath) =>
      readQmdFile(filePath, {
        companySlug: input.companySlug,
        callerId: `communications-agent-${input.companySlug}`,
        callerRole: "cfo_agent",
        port: input.companyDbPort,
      }).catch(() => null),
  });
}

export async function processCommunicationBatch(
  batch: CommunicationBatch,
): Promise<Record<string, unknown>> {
  const synthesisBatchId = randomUUID();
  const claimedMessageIds = await claimCommunicationBatch(
    batch,
    synthesisBatchId,
  );
  if (claimedMessageIds.length === 0) {
    return {
      companySlug: batch.companySlug,
      providerThreadId: batch.providerThreadId,
      dayKey: batch.dayKey,
      status: "skipped",
      reason: "already_claimed_or_processed",
    };
  }

  const messages = await loadCommunicationMessagesByIds(claimedMessageIds);
  if (messages.length === 0) {
    await markCommunicationBatchFailed(claimedMessageIds, synthesisBatchId);
    return {
      companySlug: batch.companySlug,
      providerThreadId: batch.providerThreadId,
      dayKey: batch.dayKey,
      status: "failed",
      reason: "claimed_batch_missing_messages",
    };
  }

  try {
    const sourceLabel =
      messages[0]?.subject?.trim() ||
      messages[0]?.senderName ||
      messages[0]?.senderAddress ||
      batch.providerThreadId;
    const threadSlug = buildThreadSlug(
      batch.provider,
      batch.providerThreadId,
      sourceLabel,
    );
    const priorContextRaw = await readQmdFile(
      `communications/context/${threadSlug}.qmd`,
      {
        companySlug: batch.companySlug,
        callerId: `communications-agent-${batch.companySlug}`,
        callerRole: "cfo_agent",
        port: batch.companyDbPort,
      },
    ).catch(() => null);
    const priorContext = priorContextRaw ? parseQmd(priorContextRaw) : null;

    const knownContacts = await queryEntities(
      { domain: "people", limit: 80, view: "summary" },
      {
        companySlug: batch.companySlug,
        callerId: `communications-agent-${batch.companySlug}`,
        callerRole: "cfo_agent",
        port: batch.companyDbPort,
      },
    ).catch(() => []);

    const synthesis = await runCommunicationSynthesis({
      sourceLabel,
      dayKey: batch.dayKey,
      priorContext: priorContext
        ? `${priorContext.frontmatter.title ?? "Context"}\n${priorContext.body}`
        : null,
      knownContacts: knownContacts
        .map((record) => {
          const name = frontmatterString(record.frontmatter.name ?? record.title, 160);
          const email =
            typeof record.frontmatter.channels === "object" &&
            record.frontmatter.channels !== null
              ? frontmatterString(
                  (record.frontmatter.channels as Record<string, unknown>)
                    .email,
                  160,
                )
              : "";
          const organization = frontmatterString(record.frontmatter.organization, 160);
          const relatedCompanies = frontmatterStringArray(
            record.frontmatter.related_companies,
          );
          const analysisContext = frontmatterString(
            record.frontmatter.analysis_context,
            700,
          );
          const description = frontmatterString(
            record.frontmatter.crm_description,
            500,
          );
          return [
            name ? `name=${name}` : "",
            email ? `email=${email}` : "",
            organization ? `primary_company=${organization}` : "",
            relatedCompanies.length > 0
              ? `related_companies=${relatedCompanies.join(", ")}`
              : "",
            analysisContext ? `analysis_context=${analysisContext}` : "",
            description ? `note=${description}` : "",
          ]
            .filter((value) => value.length > 0)
            .join(" | ");
        })
        .filter((value) => value.length > 0)
        .slice(0, 60),
      messages,
      onUsage: async (usage) => {
        const normalized = normalizeLlmUsage(usage);
        if (!normalized) return;
        try {
          const model = getCommunicationSynthesisModel();
          await recordLlmUsageEvent({
            companyId: batch.companyId,
            provider: "anthropic",
            model,
            subsystem: "communications_synthesis",
            operation: "daily_batch",
            executor: "communications_process_pending",
            billingMode: "api",
            usage: normalized,
            estimatedCostUsd: estimateAnthropicUsageCostUsd({
              model,
              usage: normalized,
            }),
            referenceType: "communications_batch",
            referenceId: synthesisBatchId,
            metadata: {
              companySlug: batch.companySlug,
              dayKey: batch.dayKey,
              provider: batch.provider,
              providerThreadId: batch.providerThreadId,
              sourceLabel,
              messageCount: messages.length,
              messageIds: messages.map((message) => message.id).slice(0, 50),
            },
          });
        } catch (error) {
          console.warn(
            "[communications] failed to record LLM usage event",
            error,
          );
        }
      },
    });

    const { automatic, approvalRequired } = splitSignalsByApproval(synthesis);
    const messageIds = messages.map((message) => message.id);
    const communicationFileMap = new Map<
      string,
      { path: string; content: string }
    >();
    for (const file of [
      buildCommunicationDailyLogFile({
        provider: batch.provider,
        providerThreadId: batch.providerThreadId,
        threadSlug,
        dayKey: batch.dayKey,
        sourceLabel,
        synthesis,
        messages,
      }),
      buildCommunicationContextFile({
        provider: batch.provider,
        providerThreadId: batch.providerThreadId,
        threadSlug,
        sourceLabel,
        ongoingThreads: synthesis.ongoingThreads,
        sourceMessageIds: messageIds,
      }),
      ...automatic.map((signal) => {
        const sourceIds = signal.sourceMessageIds.filter((id) =>
          messageIds.includes(id),
        );
        return buildCommunicationSignalFile({
          provider: batch.provider,
          providerThreadId: batch.providerThreadId,
          threadSlug,
          sourceLabel,
          dayKey: batch.dayKey,
          signal,
          sourceMessageIds: sourceIds.length > 0 ? sourceIds : messageIds,
        });
      }),
    ]) {
      communicationFileMap.set(file.path, file);
    }

    const allSignalRecords = await queryAllEntities(
      {
        domain: "communications",
        type: "communication_signal",
        view: "summary",
      },
      {
        companySlug: batch.companySlug,
        callerId: `communications-agent-${batch.companySlug}`,
        callerRole: "cfo_agent",
        port: batch.companyDbPort,
      },
    ).catch(() => []);

    const existingCandidates = allSignalRecords
      .map((record) => toCommitmentSignalCandidate(record))
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate),
      )
      .filter(
        (candidate) =>
          candidate.provider === batch.provider &&
          candidate.threadKey === batch.providerThreadId &&
          candidate.status === "open",
      )
      .map((candidate) => ({
        ...candidate,
        provider: candidate.provider ?? batch.provider,
        threadKey: candidate.threadKey ?? batch.providerThreadId,
      }));

    const draftCandidates = Array.from(communicationFileMap.values())
      .filter((file) => file.path.startsWith("communications/signals/"))
      .map((file) => {
        const parsed = parseQmd(file.content);
        return toCommitmentSignalCandidate({
          qualifiedId: String(parsed.frontmatter.id ?? file.path),
          type: "communication_signal",
          domain: "communications",
          filePath: file.path,
          frontmatter: parsed.frontmatter,
          title:
            typeof parsed.frontmatter.title === "string"
              ? parsed.frontmatter.title
              : null,
          status: null,
          createdAt:
            typeof parsed.frontmatter.created_at === "string"
              ? parsed.frontmatter.created_at
              : null,
          updatedAt:
            typeof parsed.frontmatter.updated_at === "string"
              ? parsed.frontmatter.updated_at
              : null,
        });
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate),
      )
      .filter((candidate) => candidate.status === "open")
      .map((candidate) => ({
        ...candidate,
        provider: candidate.provider ?? batch.provider,
        threadKey: candidate.threadKey ?? batch.providerThreadId,
      }));

    const lifecycleResolutions = findCommitmentLifecycleResolutions({
      messages,
      candidates: [...existingCandidates, ...draftCandidates],
    });

    for (const resolution of lifecycleResolutions) {
      const patch = {
        status: resolution.kind === "completion" ? "completed" : "cancelled",
        resolvedAt: resolution.resolvedAt,
        resolutionKind: resolution.kind,
        resolutionSummary: resolution.resolutionSummary,
        resolutionSourceMessageIds: resolution.resolutionSourceMessageIds,
      } as const;

      const existingDraft = communicationFileMap.get(resolution.filePath);
      if (existingDraft) {
        communicationFileMap.set(resolution.filePath, {
          path: resolution.filePath,
          content: applyCommitmentLifecycleToSignalQmd(
            existingDraft.content,
            patch,
          ),
        });
        continue;
      }

      const rawSignal = await readQmdFile(resolution.filePath, {
        companySlug: batch.companySlug,
        callerId: `communications-agent-${batch.companySlug}`,
        callerRole: "cfo_agent",
        port: batch.companyDbPort,
      }).catch(() => null);
      if (!rawSignal) continue;

      communicationFileMap.set(resolution.filePath, {
        path: resolution.filePath,
        content: applyCommitmentLifecycleToSignalQmd(rawSignal, patch),
      });
    }

    const senderContacts = deriveSenderContacts(messages);
    const peopleFiles = [];
    const lastInteraction =
      messages[messages.length - 1]?.receivedAt ?? new Date().toISOString();

    for (const contact of senderContacts) {
      const draft = buildContactFile({ contact, lastInteraction });
      const resolved = await resolveContactProfileWriteTarget({
        companySlug: batch.companySlug,
        companyDbPort: batch.companyDbPort,
        filePath: draft.path,
      });
      peopleFiles.push(
        buildContactFile({
          contact,
          existing: resolved.existing,
          lastInteraction,
          filePath: resolved.filePath,
        }),
      );
    }

    const writeQueuePort = batch.companyDbPort + 1;
    const communicationsCommit = await submitCommunicationsCommit(
      batch.companySlug,
      {
        domain: "communications",
        files: Array.from(communicationFileMap.values()),
        commitMessage: `communications(synthesis): ${batch.dayKey} ${threadSlug}`,
        metadata: {
          sourceLabel,
          provider: batch.provider,
          providerThreadId: batch.providerThreadId,
          dayKey: batch.dayKey,
        },
      },
      writeQueuePort,
    );

    let peopleCommitSha: string | null = null;
    if (peopleFiles.length > 0) {
      const peopleCommit = await submitCommunicationsCommit(
        batch.companySlug,
        {
          domain: "people",
          files: peopleFiles,
          commitMessage: `communications(people): ${batch.dayKey} ${threadSlug}`,
          metadata: {
            sourceLabel,
            provider: batch.provider,
            providerThreadId: batch.providerThreadId,
            dayKey: batch.dayKey,
          },
        },
        writeQueuePort,
      );
      peopleCommitSha = peopleCommit.commitSha;
    }

    const pendingRows = approvalRequired.map((signal) => {
      const sourceIds = signal.sourceMessageIds.filter((id) =>
        messageIds.includes(id),
      );
      const approvedFile = buildApprovedSignalImportFile({
        signal,
        targetDomain: signal.targetDomain,
        sourceLabel,
        threadSlug,
        providerThreadId: batch.providerThreadId,
        sourceMessageIds: sourceIds.length > 0 ? sourceIds : messageIds,
      });
      const approvedDoc = parseQmd(approvedFile.content);
      return {
        companyId: batch.companyId,
        dedupKey: `${batch.providerThreadId}:${signal.targetDomain}:${approvedFile.path}`,
        signalType: signal.type,
        targetDomain: signal.targetDomain,
        title: signal.title,
        summary: signal.summary,
        sourceProvider: batch.provider,
        sourceThreadId: batch.providerThreadId,
        sourceLabel,
        communicationMessageIds: sourceIds.length > 0 ? sourceIds : messageIds,
        structuredData: {
          participants: signal.participants,
          counterparties: signal.counterparties,
          amounts: signal.amounts,
          dates: signal.dates,
          keyThemes: signal.keyThemes,
          risks: signal.risks,
        },
        proposedFilePath: approvedFile.path,
        proposedFrontmatter: approvedDoc.frontmatter,
        proposedBody: approvedDoc.body,
        confidenceScore: String(signal.confidence),
      };
    });

    await insertPendingSignals(pendingRows);
    await markCommunicationBatchProcessed(messageIds, synthesisBatchId);

    if (lifecycleResolutions.length > 0) {
      const targetRefs = new Set(
        lifecycleResolutions.map((resolution) =>
          buildCommitmentNotificationReference(resolution.filePath),
        ),
      );
      const openCommitmentNotifications = await db
        .select({ id: notifications.id, message: notifications.message })
        .from(notifications)
        .where(
          and(
            eq(notifications.companyId, batch.companyId),
            inArray(notifications.type, [...COMMITMENT_NOTIFICATION_TYPES]),
            isNull(notifications.resolvedAt),
          ),
        );

      const notificationIdsToResolve = openCommitmentNotifications
        .filter((row) => {
          const reference = extractCommitmentNotificationReference(row.message);
          return reference ? targetRefs.has(reference) : false;
        })
        .map((row) => row.id);

      if (notificationIdsToResolve.length > 0) {
        await db
          .update(notifications)
          .set({ resolvedAt: new Date() })
          .where(inArray(notifications.id, notificationIdsToResolve));
      }
    }

    await refreshSummaryTargets({
      companySlug: batch.companySlug,
      port: batch.companyDbPort,
      writeQueuePort,
      domains: ["communications", "people"],
      reason: "communications_synthesis",
    }).catch((error) => {
      console.warn("[communications] summary refresh failed", error);
      return null;
    });

    return {
      companySlug: batch.companySlug,
      providerThreadId: batch.providerThreadId,
      dayKey: batch.dayKey,
      status: "processed",
      communicationsCommitSha: communicationsCommit.commitSha,
      peopleCommitSha,
      senderContactCount: senderContacts.length,
      autoSignalCount: automatic.length,
      pendingSignalCount: pendingRows.length,
      resolvedCommitmentCount: lifecycleResolutions.length,
    };
  } catch (error) {
    await markCommunicationBatchFailed(claimedMessageIds, synthesisBatchId);
    return {
      companySlug: batch.companySlug,
      providerThreadId: batch.providerThreadId,
      dayKey: batch.dayKey,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
