import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  requireRoutineDomainAccess,
  requireRoutineReviewAccess,
} from "@/lib/routines/api-access";
import {
  approveLegalWatchCandidate,
  rejectLegalWatchCandidate,
} from "@/lib/routines/legal-watch/review";
import {
  getCompanyRoutine,
  getRoutineCandidate,
  listRoutineSources,
} from "@/lib/routines/store";

function reviewConflictMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const isConflict =
    error.message.includes("already") ||
    error.message.includes("no longer pending") ||
    error.message.includes("approval claim");
  return isConflict ? error.message : null;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ routineId: string; candidateId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, candidateId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "read");

    const candidate = await getRoutineCandidate({
      companyId: auth.companyId,
      routineId,
      candidateId,
    });
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const sources = await listRoutineSources(auth.companyId, routineId);
    return NextResponse.json({
      candidate,
      proposedFrontmatter: candidate.proposedFrontmatter,
      proposedBody: candidate.proposedBody,
      routine: {
        id: routine.id,
        slug: routine.slug,
        title: routine.title,
        templateKey: routine.templateKey,
        domain: routine.domain,
        jurisdiction: routine.jurisdiction,
        topic: routine.topic,
        status: routine.status,
        reviewPolicy: routine.reviewPolicy,
        digestPolicy: routine.digestPolicy,
      },
      sources,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ routineId: string; candidateId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, candidateId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineReviewAccess(auth, routine);
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const reviewReason = typeof body.reviewReason === "string" ? body.reviewReason : null;
    if (action === "reject") {
      try {
        const candidate = await rejectLegalWatchCandidate({
          companyId: auth.companyId,
          routineId,
          candidateId,
          reviewedBy: auth.userId,
          reviewReason,
        });
        return NextResponse.json({ candidate, status: "rejected" });
      } catch (error) {
        const conflict = reviewConflictMessage(error);
        if (conflict) {
          return NextResponse.json({ error: conflict }, { status: 409 });
        }
        throw error;
      }
    }
    if (action === "approve") {
      try {
        const result = await approveLegalWatchCandidate({
          companyId: auth.companyId,
          routineId,
          candidateId,
          reviewedBy: auth.userId,
          reviewReason,
        });
        return NextResponse.json({
          candidate: result.candidate,
          status: "approved",
          commitSha: result.commitSha,
        });
      } catch (error) {
        const conflict = reviewConflictMessage(error);
        if (conflict) {
          return NextResponse.json({ error: conflict }, { status: 409 });
        }
        throw error;
      }
    }
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
