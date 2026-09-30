import { eq } from "drizzle-orm";

import { getCompanySlug } from "@/lib/company-db/tenant";
import { submitCompanyDbCommit } from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { toQmd } from "@/lib/company-db/summary/qmd";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import {
  claimRoutineCandidateForApproval,
  getRoutineCandidate,
  releaseRoutineCandidateApprovalClaim,
  resolveRoutineCandidate,
} from "@/lib/routines/store";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedLegalWatchRoutineSlug(value: unknown): boolean {
  return typeof value === "string" &&
    (value === "legal-watch-bkpm" || value.startsWith("legal-watch-bkpm-"));
}

function assertLegalWatchApprovalTarget(candidate: {
  targetDomain: string;
  targetPath: string;
  proposedFrontmatter: unknown;
}) {
  if (candidate.targetDomain !== "legal") {
    throw new Error("Legal Watch approvals can only write to the legal domain");
  }
  if (
    !candidate.targetPath.startsWith("legal/watch/bkpm/updates/") ||
    !candidate.targetPath.endsWith(".qmd") ||
    candidate.targetPath.includes("..") ||
    candidate.targetPath.startsWith("/")
  ) {
    throw new Error("Legal Watch approval target path is outside legal/watch/bkpm/updates");
  }
  if (!isRecord(candidate.proposedFrontmatter)) {
    throw new Error("Legal Watch approval frontmatter is invalid");
  }
  if (candidate.proposedFrontmatter.type !== "routine_legal_update") {
    throw new Error("Legal Watch approval frontmatter type is invalid");
  }
  if (!isAllowedLegalWatchRoutineSlug(candidate.proposedFrontmatter.routine_slug)) {
    throw new Error("Legal Watch approval frontmatter routine slug is invalid");
  }
}

export async function approveLegalWatchCandidate(input: {
  companyId: string;
  routineId: string;
  candidateId: string;
  reviewedBy: string;
  reviewReason?: string | null;
}) {
  const candidate = await claimRoutineCandidateForApproval({
    companyId: input.companyId,
    routineId: input.routineId,
    candidateId: input.candidateId,
    reviewedBy: input.reviewedBy,
  });
  if (!candidate) {
    const existing = await getRoutineCandidate(input);
    if (!existing) throw new Error("Legal Watch candidate not found");
    throw new Error(`Legal Watch candidate already ${existing.reviewStatus}`);
  }

  try {
    assertLegalWatchApprovalTarget(candidate);
  } catch (error) {
    await releaseRoutineCandidateApprovalClaim({
      companyId: input.companyId,
      routineId: input.routineId,
      candidateId: input.candidateId,
      reviewedBy: input.reviewedBy,
      error: errorMessage(error),
    }).catch((releaseError) => {
      console.warn("[legal-watch] failed to release invalid approval claim", releaseError);
      return null;
    });
    throw error;
  }

  const companySlug = await getCompanySlug(input.companyId);
  const [companyRow] = await db
    .select({ companyDbPort: companies.companyDbPort })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);
  const basePort = companyRow?.companyDbPort ?? 3100;
  const content = toQmd(candidate.proposedFrontmatter, candidate.proposedBody);

  let commit: Awaited<ReturnType<typeof submitCompanyDbCommit>>;
  try {
    commit = await submitCompanyDbCommit(
      companySlug,
      {
        domain: candidate.targetDomain,
        filePath: candidate.targetPath,
        content,
        commitMessage: `legal-watch(approve): ${candidate.title}`,
        metadata: {
          source: "legal-watch",
          routineId: input.routineId,
          candidateId: input.candidateId,
        },
      },
      basePort + 1,
    );
  } catch (error) {
    await releaseRoutineCandidateApprovalClaim({
      companyId: input.companyId,
      routineId: input.routineId,
      candidateId: input.candidateId,
      reviewedBy: input.reviewedBy,
      error: errorMessage(error),
    }).catch((releaseError) => {
      console.warn("[legal-watch] failed to release approval claim", releaseError);
      return null;
    });
    throw error;
  }

  const resolved = await resolveRoutineCandidate({
    companyId: input.companyId,
    routineId: input.routineId,
    candidateId: input.candidateId,
    status: "approved",
    reviewedBy: input.reviewedBy,
    reviewReason: input.reviewReason,
    commitSha: commit.commitSha,
    expectedStatus: "approving",
  });
  if (!resolved) {
    throw new Error("Legal Watch approval claim was lost before finalization");
  }

  await refreshSummaryTargets({
    companySlug,
    port: basePort,
    writeQueuePort: basePort + 1,
    domains: ["legal"],
    reason: "legal_watch_approval",
  }).catch((error) => {
    console.warn("[legal-watch] summary refresh after approval failed", error);
    return null;
  });

  return { candidate: resolved, commitSha: commit.commitSha };
}

export async function rejectLegalWatchCandidate(input: {
  companyId: string;
  routineId: string;
  candidateId: string;
  reviewedBy: string;
  reviewReason?: string | null;
}) {
  const candidate = await getRoutineCandidate(input);
  if (!candidate) throw new Error("Legal Watch candidate not found");
  if (candidate.reviewStatus !== "pending") {
    throw new Error(`Legal Watch candidate already ${candidate.reviewStatus}`);
  }
  const resolved = await resolveRoutineCandidate({
    companyId: input.companyId,
    routineId: input.routineId,
    candidateId: input.candidateId,
    status: "rejected",
    reviewedBy: input.reviewedBy,
    reviewReason: input.reviewReason,
    commitSha: null,
    expectedStatus: "pending",
  });
  if (!resolved) throw new Error("Legal Watch candidate is no longer pending");
  return resolved;
}
