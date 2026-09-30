import { getCompanySlug } from "@/lib/company-db/tenant";
import { submitCompanyDbCommit } from "@/lib/company-db/client";
import {
  buildLegalWatchDigestQmd,
  type LegalWatchDigestWindowStats,
} from "@/lib/routines/legal-watch/digest";
import {
  createRoutineDigestArtifact,
  countRoutineCandidatesByWindow,
  countRoutineObservationsByWindow,
  getCompanyRoutine,
  listRoutineCandidates,
  listRoutineSources,
} from "@/lib/routines/store";

function emptyStats(): LegalWatchDigestWindowStats {
  return {
    sourcesChecked: 0,
    changedSources: 0,
    newCandidates: 0,
    approvedCandidates: 0,
    rejectedCandidates: 0,
    pendingCandidates: 0,
    highConfidenceUpdates: 0,
    possiblySupersededItems: 0,
    sourceErrors: 0,
  };
}

function applyCandidateCounts(
  stats: LegalWatchDigestWindowStats,
  rows: Array<{ reviewStatus: string; legalStatus: string; count: number }>,
) {
  for (const row of rows) {
    stats.newCandidates += row.count;
    if (row.reviewStatus === "approved") stats.approvedCandidates += row.count;
    if (row.reviewStatus === "rejected") stats.rejectedCandidates += row.count;
    if (row.reviewStatus === "pending") stats.pendingCandidates += row.count;
    if (row.legalStatus === "possibly_superseded") stats.possiblySupersededItems += row.count;
  }
}

function applyObservationCounts(
  stats: LegalWatchDigestWindowStats,
  rows: Array<{ changeKind: string; status: string; count: number }>,
) {
  for (const row of rows) {
    stats.sourcesChecked += row.count;
    if (row.changeKind === "new" || row.changeKind === "changed" || row.changeKind === "gone") {
      stats.changedSources += row.count;
    }
    if (row.changeKind === "error" || row.status === "failed") {
      stats.sourceErrors += row.count;
    }
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function digestOperatorGuidance(sourcePolicy: unknown) {
  const policy = recordValue(sourcePolicy);
  return {
    collectionInstructions: stringValue(policy.collectionInstructions),
    watchTopics: stringArrayValue(policy.watchTopics),
    includeKeywords: stringArrayValue(policy.includeKeywords),
    excludeKeywords: stringArrayValue(policy.excludeKeywords),
    reviewerChecklist: stringArrayValue(policy.reviewerChecklist),
  };
}

export async function buildAndPersistLegalWatchDigestPreview(input: {
  companyId: string;
  routineId: string;
  companyDbPort: number;
  windowStart: Date;
  windowEnd: Date;
}) {
  const routine = await getCompanyRoutine(input.companyId, input.routineId);
  if (!routine) throw new Error("Routine not found");

  const windowMs = input.windowEnd.getTime() - input.windowStart.getTime();
  const previousStart = new Date(input.windowStart.getTime() - windowMs);
  const previousEnd = new Date(input.windowStart.getTime());
  const current = emptyStats();
  const previous = emptyStats();
  applyObservationCounts(
    current,
    await countRoutineObservationsByWindow({
      companyId: input.companyId,
      routineId: input.routineId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    }),
  );
  applyObservationCounts(
    previous,
    await countRoutineObservationsByWindow({
      companyId: input.companyId,
      routineId: input.routineId,
      windowStart: previousStart,
      windowEnd: previousEnd,
    }),
  );
  applyCandidateCounts(
    current,
    await countRoutineCandidatesByWindow({
      companyId: input.companyId,
      routineId: input.routineId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    }),
  );
  applyCandidateCounts(
    previous,
    await countRoutineCandidatesByWindow({
      companyId: input.companyId,
      routineId: input.routineId,
      windowStart: previousStart,
      windowEnd: previousEnd,
    }),
  );

  const sources = (await listRoutineSources(input.companyId, input.routineId)).map((source) => ({
    title: source.title,
    url: source.url,
    trustTier: source.trustTier,
    changed:
      source.lastChangedAt !== null &&
      source.lastChangedAt.getTime() >= input.windowStart.getTime() &&
      source.lastChangedAt.getTime() < input.windowEnd.getTime(),
    error: source.lastError,
  }));

  const allCandidates = await listRoutineCandidates({
    companyId: input.companyId,
    routineId: input.routineId,
  });
  const candidates = allCandidates
    .filter((candidate) => {
      const created = candidate.createdAt.getTime();
      return created >= input.windowStart.getTime() && created < input.windowEnd.getTime();
    })
    .map((candidate) => ({
      title: candidate.title,
      targetPath: candidate.targetPath,
      targetDomain: candidate.targetDomain,
      reviewStatus: candidate.reviewStatus,
      legalStatus: candidate.legalStatus,
      confidenceScore: candidate.confidenceScore === null ? null : Number(candidate.confidenceScore),
      sourceDate: candidate.sourceDate?.toISOString() ?? null,
      sourceUrls: candidate.sourceUrls,
      summary: candidate.summary,
    }));

  const digest = buildLegalWatchDigestQmd({
    routineSlug: routine.slug,
    jurisdiction: routine.jurisdiction ?? "ID",
    scopeType: routine.scopeType,
    scopeId: routine.scopeId ?? input.companyId,
    impactedCompanyIds: [input.companyId],
    impactedDomains: ["legal"],
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    previousWindowStart: previousStart.toISOString(),
    previousWindowEnd: previousEnd.toISOString(),
    current,
    previous,
    sources,
    candidates,
    operatorGuidance: digestOperatorGuidance(routine.sourcePolicy),
  });
  const companySlug = await getCompanySlug(input.companyId);
  const commit = await submitCompanyDbCommit(
    companySlug,
    {
      domain: "legal",
      filePath: digest.path,
      content: digest.content,
      commitMessage: `legal-watch(digest): ${routine.slug} ${input.windowStart.toISOString().slice(0, 10)}`,
      metadata: {
        source: "legal-watch-digest",
        routineId: input.routineId,
        windowStart: input.windowStart.toISOString(),
        windowEnd: input.windowEnd.toISOString(),
        delivery: "disabled",
      },
    },
    input.companyDbPort + 1,
  );

  const artifact = await createRoutineDigestArtifact({
    routineId: input.routineId,
    companyId: input.companyId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    candidateCount: current.newCandidates,
    approvedCount: current.approvedCandidates,
    rejectedCount: current.rejectedCandidates,
    changedSourceCount: current.changedSources,
    previousWindowStats: { ...previous },
    artifactPath: digest.path,
    commitSha: commit.commitSha,
    metadata: { delivery: "disabled" },
  });

  return { artifact, digest, commitSha: commit.commitSha, current, previous };
}
