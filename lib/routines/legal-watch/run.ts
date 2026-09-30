import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { routineObservations } from "@/lib/db/schema";
import {
  estimateAnthropicUsageCostUsd,
  normalizeLlmUsage,
  recordLlmUsageEvent,
} from "@/lib/llm-usage-events";
import { canRunRoutineNow, isLegalWatchEnabledForCompany } from "@/lib/routines/api-access";
import {
  readLegalWatchSourceProviderConfig,
  routineSourceToDefinition,
} from "@/lib/routines/source-config";
import {
  classifyLegalWatchChange,
  hashLegalWatchContent,
  type LegalWatchFetch,
} from "@/lib/routines/legal-watch/collector";
import { persistLegalWatchEvidence } from "@/lib/routines/legal-watch/evidence";
import { translateLegalWatchDisplay } from "@/lib/routines/legal-watch/localization";
import { fetchLegalWatchSourceWithProvider } from "@/lib/routines/legal-watch/providers";
import {
  buildLegalWatchCandidateDraft,
  type LegalWatchOperatorGuidance,
} from "@/lib/routines/legal-watch/normalizer";
import {
  createRoutineObservation,
  createRoutineUpdateCandidate,
  getCompanyRoutine,
  getRoutineCandidateByDedupKey,
  getRoutineRun,
  listActiveRoutineSources,
  reconcileBkpmLegalWatchRoutineSources,
  updateRoutineRun,
  updateRoutineSourceAfterObservation,
} from "@/lib/routines/store";
import type { RoutineRunStats } from "@/lib/routines/types";

function readSourceMetadataFlag(source: { metadata?: unknown }, key: string): boolean {
  if (!source.metadata || typeof source.metadata !== "object" || Array.isArray(source.metadata)) {
    return false;
  }
  return (source.metadata as Record<string, unknown>)[key] === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 50);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readLegalWatchOperatorGuidance(input: {
  routine: { sourcePolicy?: unknown };
  source: { metadata?: unknown };
}): LegalWatchOperatorGuidance {
  const sourcePolicy = recordValue(input.routine.sourcePolicy);
  const sourceMetadata = recordValue(input.source.metadata);
  return {
    collectionInstructions: stringValue(sourcePolicy.collectionInstructions),
    watchTopics: stringArrayValue(sourcePolicy.watchTopics),
    includeKeywords: stringArrayValue(sourcePolicy.includeKeywords),
    excludeKeywords: stringArrayValue(sourcePolicy.excludeKeywords),
    reviewerChecklist: stringArrayValue(sourcePolicy.reviewerChecklist),
    sourceInstructions: stringValue(sourceMetadata.operatorInstructions),
  };
}

function guidanceHasText(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function readMaxSourcesPerRun(sourcePolicy: unknown): number {
  const value = recordValue(sourcePolicy).maxSourcesPerRun;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 20)
    : 20;
}

export function shouldCreateLegalWatchCandidateForSource(
  source: { sourceKey?: string; title?: string; topicTags?: string[]; metadata?: unknown },
  options?: {
    resultText?: string;
    operatorGuidance?: LegalWatchOperatorGuidance;
  },
): boolean {
  if (readSourceMetadataFlag(source, "discoveryOnly")) return false;
  if (readSourceMetadataFlag(source, "secondaryCommentaryOnly")) return false;

  const guidance = options?.operatorGuidance;
  if (!guidance) return true;
  const searchable = [
    source.sourceKey ?? "",
    source.title ?? "",
    ...(source.topicTags ?? []),
    options?.resultText ?? "",
  ].join(" ");
  if (guidance.excludeKeywords?.length && guidanceHasText(searchable, guidance.excludeKeywords)) {
    return false;
  }
  if (guidance.includeKeywords?.length && !guidanceHasText(searchable, guidance.includeKeywords)) {
    return false;
  }
  return true;
}

async function recordLegalWatchSourceErrorObservation(input: {
  companyId: string;
  runId: string;
  source: {
    id: string;
    sourceKey: string;
    title: string;
    url: string;
  };
  error: string;
  provider?: string;
}) {
  const errorHash = hashLegalWatchContent(input.error);
  await createRoutineObservation({
    routineRunId: input.runId,
    routineSourceId: input.source.id,
    companyId: input.companyId,
    sourceEventId: `error:${input.runId}:${input.source.sourceKey}`,
    idempotencyKey: `routine-run:${input.runId}:source:${input.source.sourceKey}:error:${errorHash}`,
    contentHash: null,
    canonicalUrl: input.source.url,
    sourceTitle: input.source.title,
    sourceDate: null,
    fetchedAt: new Date(),
    rawEventId: null,
    snapshotRef: null,
    changeKind: "error",
    status: "failed",
    metadata: {
      error: input.error,
      sourceKey: input.source.sourceKey,
      ...(input.provider ? { provider: input.provider } : {}),
    },
  });
}

function incrementProviderStats(stats: RoutineRunStats, provider: string): void {
  stats.providerCounts = {
    ...(stats.providerCounts ?? {}),
    [provider]: (stats.providerCounts?.[provider] ?? 0) + 1,
  };
  if (provider === "apify") stats.apifyRunCount = (stats.apifyRunCount ?? 0) + 1;
}

export async function executeLegalWatchRunWithFailureBoundary(input: {
  companyId: string;
  routineId: string;
  runId: string;
  fetchImpl?: LegalWatchFetch;
}): Promise<RoutineRunStats> {
  try {
    return await executeLegalWatchRun(input);
  } catch (error) {
    await updateRoutineRun({
      companyId: input.companyId,
      routineId: input.routineId,
      runId: input.runId,
      status: "failed",
      finishedAt: new Date(),
      error: errorMessage(error),
      stats: {
        fatalError: true,
        error: errorMessage(error),
      },
    }).catch((updateError) => {
      console.warn("[legal-watch] failed to mark run as failed", updateError);
      return null;
    });
    throw error;
  }
}

export async function executeLegalWatchRun(input: {
  companyId: string;
  routineId: string;
  runId: string;
  fetchImpl?: LegalWatchFetch;
}): Promise<RoutineRunStats> {
  const routine = await getCompanyRoutine(input.companyId, input.routineId);
  if (!routine) throw new Error("Routine not found");
  if (routine.templateKey !== "legal_watch_bkpm") {
    throw new Error(`Unsupported legal watch template: ${routine.templateKey}`);
  }
  const run = await getRoutineRun({
    companyId: input.companyId,
    routineId: input.routineId,
    runId: input.runId,
  });
  if (!run) {
    throw new Error("Routine run not found for company and routine");
  }
  if (!isLegalWatchEnabledForCompany(input.companyId)) {
    const stats: RoutineRunStats = {
      sourceCount: 0,
      fetchedCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      candidateCount: 0,
      errorCount: 0,
    };
    await updateRoutineRun({
      companyId: input.companyId,
      routineId: input.routineId,
      runId: input.runId,
      status: "cancelled",
      finishedAt: new Date(),
      error: "Legal Watch is not enabled for this company",
      stats: {
        ...stats,
        cancelled: true,
        reason: "rollout_disabled",
      },
    });
    return stats;
  }
  if (!canRunRoutineNow(routine.status)) {
    throw new Error("Routine must be active or paused before it can run");
  }

  await reconcileBkpmLegalWatchRoutineSources({
    companyId: input.companyId,
    routineId: input.routineId,
  });
  const sources = (await listActiveRoutineSources(input.companyId, input.routineId))
    .slice(0, readMaxSourcesPerRun(routine.sourcePolicy));
  const stats: RoutineRunStats = {
    sourceCount: sources.length,
    fetchedCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    candidateCount: 0,
    errorCount: 0,
  };

  await updateRoutineRun({
    companyId: input.companyId,
    routineId: input.routineId,
    runId: input.runId,
    status: "running",
    startedAt: new Date(),
    stats: { ...stats },
  });

  for (const source of sources) {
    const provider = readLegalWatchSourceProviderConfig(source).collectorProvider;
    incrementProviderStats(stats, provider);
    try {
      const result = await fetchLegalWatchSourceWithProvider(routineSourceToDefinition(source), {
        fetchImpl: input.fetchImpl,
      });
      stats.fetchedCount += 1;
      const changeKind = classifyLegalWatchChange({
        previousContentHash: source.lastContentHash,
        nextContentHash: result.contentHash,
      });
      if (changeKind === "unchanged") stats.unchangedCount += 1;
      else stats.changedCount += 1;

      const evidence = await persistLegalWatchEvidence({
        companyId: input.companyId,
        routineSlug: routine.slug,
        runId: input.runId,
        sourceId: source.id,
        result,
        changeKind,
      });

      if (changeKind !== "unchanged") {
        const operatorGuidance = readLegalWatchOperatorGuidance({ routine, source });
        const createCandidate = shouldCreateLegalWatchCandidateForSource(source, {
          resultText: `${result.title}\n${result.bodyText}`,
          operatorGuidance,
        });
        let candidateCreatedForObservation = false;
        if (createCandidate) {
          const generatedAt = new Date().toISOString();
          const draftWithoutDisplay = buildLegalWatchCandidateDraft({
            routineSlug: routine.slug,
            source,
            result,
            observationId: evidence.observation.id,
            changeKind,
            operatorGuidance,
            generatedAt,
          });
          const duplicateCandidate = await getRoutineCandidateByDedupKey({
            companyId: input.companyId,
            dedupKey: draftWithoutDisplay.dedupKey,
          });
          if (!duplicateCandidate) {
            const displayTranslations = await translateLegalWatchDisplay({
              title: draftWithoutDisplay.title,
              summary: draftWithoutDisplay.summary,
              sourceLanguage: stringValue(recordValue(source.metadata).sourceLanguage) ?? "id",
              generatedAt,
              onUsage: async (usage, model) => {
                const normalizedUsage = normalizeLlmUsage(usage);
                if (!normalizedUsage) return;
                try {
                  await recordLlmUsageEvent({
                    companyId: input.companyId,
                    provider: "anthropic",
                    model,
                    subsystem: "legal_watch",
                    operation: "candidate_display_translation",
                    executor: "legal_watch_run",
                    billingMode: "api",
                    usage: normalizedUsage,
                    estimatedCostUsd: estimateAnthropicUsageCostUsd({
                      model,
                      usage: normalizedUsage,
                    }),
                    referenceType: "routine_source",
                    referenceId: source.id,
                    metadata: {
                      routineId: input.routineId,
                      runId: input.runId,
                      sourceKey: source.sourceKey,
                      candidateDedupKey: draftWithoutDisplay.dedupKey,
                    },
                  });
                } catch (error) {
                  console.warn("[legal-watch] failed to record translation usage", error);
                }
              },
            });
            const draft = buildLegalWatchCandidateDraft({
              routineSlug: routine.slug,
              source,
              result,
              observationId: evidence.observation.id,
              changeKind,
              operatorGuidance,
              displayTranslations,
              generatedAt,
            });
            const { created } = await createRoutineUpdateCandidate({
              routineId: input.routineId,
              companyId: input.companyId,
              dedupKey: draft.dedupKey,
              targetPath: draft.targetPath,
              title: draft.title,
              summary: draft.summary,
              jurisdiction: draft.jurisdiction,
              sourceDate: draft.sourceDate,
              confidenceScore: draft.confidenceScore,
              legalStatus: draft.legalStatus,
              sourceUrls: draft.sourceUrls,
              observationIds: draft.observationIds,
              proposedFrontmatter: draft.proposedFrontmatter,
              proposedBody: draft.proposedBody,
            });
            if (created) {
              stats.candidateCount += 1;
              candidateCreatedForObservation = true;
            }
          }
        }
        await db
          .update(routineObservations)
          .set({
            status: candidateCreatedForObservation ? "candidate_created" : "ignored",
            updatedAt: new Date(),
          })
          .where(eq(routineObservations.id, evidence.observation.id));
      }

      await updateRoutineSourceAfterObservation({
        companyId: input.companyId,
        sourceId: source.id,
        contentHash: result.contentHash,
        changed: changeKind !== "unchanged",
        error: null,
      });
    } catch (error) {
      stats.errorCount += 1;
      const message = errorMessage(error);
      await recordLegalWatchSourceErrorObservation({
        companyId: input.companyId,
        runId: input.runId,
        source,
        error: message,
        provider: provider === "native" ? undefined : provider,
      }).catch((observationError) => {
        console.warn("[legal-watch] failed to record source error observation", observationError);
        return null;
      });
      if (provider !== "native") stats.providerErrorCount = (stats.providerErrorCount ?? 0) + 1;
      await updateRoutineSourceAfterObservation({
        companyId: input.companyId,
        sourceId: source.id,
        contentHash: null,
        changed: false,
        error: message,
      });
    }
  }

  await updateRoutineRun({
    companyId: input.companyId,
    routineId: input.routineId,
    runId: input.runId,
    status: stats.errorCount > 0 ? "completed_with_errors" : "completed",
    finishedAt: new Date(),
    stats: { ...stats },
  });

  return stats;
}
