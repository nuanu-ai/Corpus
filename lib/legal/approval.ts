/**
 * Legal comparison approval gate (handoff CORPUS-42).
 *
 * When a comparison reaches awaiting_review, the runner creates a chat_approvals
 * row. The user approves/rejects via POST /api/legal/approve, which transitions
 * the job to completed (approved) or failed (rejected).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatArtifacts, chatApprovals } from "@/lib/db/schema";
import type { LegalJobStatus } from "@/lib/legal/job";

export const LEGAL_APPROVAL_ACTION = "legal_comparison_review";

/**
 * Create a pending approval request linked to the comparison artifact.
 * Called by the runner when the job reaches awaiting_review.
 */
export async function createLegalApproval(input: {
  artifactId: string;
  threadId: string;
  companyId: string;
  requestedByUserId: string;
}): Promise<void> {
  await db
    .insert(chatApprovals)
    .values({
      threadId: input.threadId,
      companyId: input.companyId,
      artifactId: input.artifactId,
      action: LEGAL_APPROVAL_ACTION,
      status: "pending",
      requestedBy: input.requestedByUserId,
      payload: { artifactId: input.artifactId },
    })
    .onConflictDoNothing();
}

/**
 * Resolve the approval. Approved → job completed; rejected → job failed.
 * Returns the final job status. Throws if the approval is not found or already
 * resolved.
 */
export async function resolveLegalApproval(input: {
  artifactId: string;
  threadId: string;
  companyId: string;
  approved: boolean;
  resolvedByUserId: string;
}): Promise<{ finalStatus: LegalJobStatus }> {
  // 1. Update the approval row (only if pending)
  const result = await db
    .update(chatApprovals)
    .set({
      status: input.approved ? "approved" : "rejected",
      approvedBy: input.resolvedByUserId,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatApprovals.artifactId, input.artifactId),
        eq(chatApprovals.threadId, input.threadId),
        eq(chatApprovals.companyId, input.companyId),
        eq(chatApprovals.status, "pending"),
      ),
    )
    .returning({ id: chatApprovals.id });

  if (result.length === 0) {
    throw new Error(
      "Legal comparison approval not found or already resolved",
    );
  }

  // 2. Transition the job status
  const finalStatus: LegalJobStatus = input.approved ? "completed" : "failed";

  // 3. Read current metadata + update
  const [row] = await db
    .select({ metadata: chatArtifacts.metadata })
    .from(chatArtifacts)
    .where(
      and(
        eq(chatArtifacts.id, input.artifactId),
        eq(chatArtifacts.threadId, input.threadId),
      ),
    )
    .limit(1);

  if (row) {
    const meta = row.metadata as Record<string, unknown> | null;
    const updatedMeta: Record<string, unknown> = {
      ...(meta ?? {}),
      jobStatus: finalStatus,
      updatedAt: new Date().toISOString(),
      ...(input.approved ? {} : { error: "Rejected by reviewer" }),
    };

    await db
      .update(chatArtifacts)
      .set({
        metadata: updatedMeta,
        status: input.approved ? "ready" : "draft",
        updatedAt: new Date(),
      })
      .where(eq(chatArtifacts.id, input.artifactId));
  }

  return { finalStatus };
}
