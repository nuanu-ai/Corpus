import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";

import { submitCompanyDbCommit } from "@/lib/company-db/client";
import { getCompanySlug } from "@/lib/company-db/tenant";
import {
  executeChatDirectWriteApproval,
  isChatDirectWriteApprovalAction,
} from "@/lib/consultant/chat-write-approvals";
import {
  EXECUTING_APPROVAL_STALE_MS,
  isChatApprovalExecutionStale,
} from "@/lib/consultant/chat-approval-recovery";
import { normalizeCompanyDbCommitApprovalPayload } from "@/lib/consultant/company-db-approval";
import { readConsultantArtifactFile } from "@/lib/consultant/workspace";
import { db } from "@/lib/db";
import {
  chatApprovals,
  chatArtifacts,
  companies,
} from "@/lib/db/schema";

const companyDbCommitPayloadSchema = z.object({
  domain: z.string().trim().min(1).max(80),
  filePath: z.string().trim().min(1).max(240),
  commitMessage: z.string().trim().min(1).max(240),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function failStaleExecutingApproval(input: {
  threadId: string;
  approvalId: string;
  companyId: string;
  payload: unknown;
  artifactMetadata: unknown;
  staleBefore: Date;
  now: Date;
}) {
  const [approval] = await db.transaction(async (tx) => {
    const [updatedApproval] = await tx
      .update(chatApprovals)
      .set({
        status: "failed",
        payload: {
          ...asRecord(input.payload),
          execution: {
            status: "failed",
            reason: "stale_execution_unknown_outcome",
            failedAt: input.now.toISOString(),
          },
        },
        updatedAt: input.now,
      })
      .where(
        and(
          eq(chatApprovals.id, input.approvalId),
          eq(chatApprovals.threadId, input.threadId),
          eq(chatApprovals.companyId, input.companyId),
          eq(chatApprovals.status, "executing"),
          lte(chatApprovals.updatedAt, input.staleBefore),
        ),
      )
      .returning(approvalReturning);

    if (updatedApproval?.artifactId) {
      await tx
        .update(chatArtifacts)
        .set({
          status: "failed",
          metadata: {
            ...asRecord(input.artifactMetadata),
            approvalExecution: {
              status: "failed",
              reason: "stale_execution_unknown_outcome",
              failedAt: input.now.toISOString(),
            },
          },
          updatedAt: input.now,
        })
        .where(
          and(
            eq(chatArtifacts.id, updatedApproval.artifactId),
            eq(chatArtifacts.threadId, input.threadId),
            eq(chatArtifacts.companyId, input.companyId),
          ),
        );
    }

    return [updatedApproval] as const;
  });

  return approval ? serializeApproval(approval) : null;
}

const approvalReturning = {
  id: chatApprovals.id,
  artifactId: chatApprovals.artifactId,
  action: chatApprovals.action,
  status: chatApprovals.status,
  payload: chatApprovals.payload,
  requestedBy: chatApprovals.requestedBy,
  approvedBy: chatApprovals.approvedBy,
  resolvedAt: chatApprovals.resolvedAt,
  createdAt: chatApprovals.createdAt,
  updatedAt: chatApprovals.updatedAt,
};

type ApprovalResponseRow = {
  id: string;
  artifactId: string | null;
  action: string;
  status: string;
  payload: Record<string, unknown>;
  requestedBy: string | null;
  approvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeApproval(approval: ApprovalResponseRow) {
  return {
    ...approval,
    resolvedAt: approval.resolvedAt?.toISOString() ?? null,
    createdAt: approval.createdAt.toISOString(),
    updatedAt: approval.updatedAt.toISOString(),
  };
}

async function fetchApprovalForResponse(input: {
  threadId: string;
  approvalId: string;
  companyId: string;
}) {
  const [approval] = await db
    .select(approvalReturning)
    .from(chatApprovals)
    .where(
      and(
        eq(chatApprovals.id, input.approvalId),
        eq(chatApprovals.threadId, input.threadId),
        eq(chatApprovals.companyId, input.companyId),
      ),
    )
    .limit(1);

  return approval ? serializeApproval(approval) : null;
}

export async function resolveChatApprovalDecision(input: {
  threadId: string;
  approvalId: string;
  companyId: string;
  userId: string;
  status: "approved" | "rejected";
}) {
  const now = new Date();

  const [currentApproval] = await db
    .select({
      id: chatApprovals.id,
      artifactId: chatApprovals.artifactId,
      action: chatApprovals.action,
      status: chatApprovals.status,
      payload: chatApprovals.payload,
      requestedBy: chatApprovals.requestedBy,
      approvedBy: chatApprovals.approvedBy,
      resolvedAt: chatApprovals.resolvedAt,
      createdAt: chatApprovals.createdAt,
      updatedAt: chatApprovals.updatedAt,
      artifactFilePath: chatArtifacts.filePath,
      artifactTitle: chatArtifacts.title,
      artifactMetadata: chatArtifacts.metadata,
    })
    .from(chatApprovals)
    .leftJoin(chatArtifacts, eq(chatApprovals.artifactId, chatArtifacts.id))
    .where(
      and(
        eq(chatApprovals.id, input.approvalId),
        eq(chatApprovals.threadId, input.threadId),
        eq(chatApprovals.companyId, input.companyId),
      ),
    )
    .limit(1);

  if (!currentApproval) {
    return null;
  }

  const staleBefore = new Date(now.getTime() - EXECUTING_APPROVAL_STALE_MS);
  const staleExecutingApproval =
    currentApproval.status === "executing" &&
    isChatApprovalExecutionStale({
      updatedAt: currentApproval.updatedAt,
      now,
    });

  const canRetryExecutingDirectWrite =
    input.status === "approved" &&
    currentApproval.status === "executing" &&
    staleExecutingApproval &&
    isChatDirectWriteApprovalAction(currentApproval.action);

  if (
    input.status === "approved" &&
    currentApproval.action === "commit_company_db" &&
    staleExecutingApproval
  ) {
    return (
      (await failStaleExecutingApproval({
        threadId: input.threadId,
        approvalId: input.approvalId,
        companyId: input.companyId,
        payload: currentApproval.payload,
        artifactMetadata: currentApproval.artifactMetadata,
        staleBefore,
        now,
      })) ?? fetchApprovalForResponse(input)
    );
  }

  if (currentApproval.status !== "pending" && !canRetryExecutingDirectWrite) {
    return serializeApproval({
      id: currentApproval.id,
      artifactId: currentApproval.artifactId,
      action: currentApproval.action,
      status: currentApproval.status,
      payload: asRecord(currentApproval.payload),
      requestedBy: currentApproval.requestedBy,
      approvedBy: currentApproval.approvedBy,
      resolvedAt: currentApproval.resolvedAt,
      createdAt: currentApproval.createdAt,
      updatedAt: currentApproval.updatedAt,
    });
  }

  if (input.status === "rejected") {
    const [approval] = await db.transaction(async (tx) => {
      const [updatedApproval] = await tx
        .update(chatApprovals)
        .set({
          status: "rejected",
          approvedBy: input.userId,
          payload: asRecord(currentApproval.payload),
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(chatApprovals.id, input.approvalId),
            eq(chatApprovals.threadId, input.threadId),
            eq(chatApprovals.companyId, input.companyId),
            eq(chatApprovals.status, "pending"),
          ),
        )
        .returning(approvalReturning);

      if (updatedApproval?.artifactId) {
        await tx
          .update(chatArtifacts)
          .set({
            status: "rejected",
            metadata: asRecord(currentApproval.artifactMetadata),
            updatedAt: now,
          })
          .where(
            and(
              eq(chatArtifacts.id, updatedApproval.artifactId),
              eq(chatArtifacts.threadId, input.threadId),
              eq(chatArtifacts.companyId, input.companyId),
            ),
          );
      }

      return [updatedApproval] as const;
    });

    return approval
      ? serializeApproval(approval)
      : fetchApprovalForResponse(input);
  }

  if (canRetryExecutingDirectWrite) {
    const [claimedApproval] = await db
      .update(chatApprovals)
      .set({
        approvedBy: input.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatApprovals.id, input.approvalId),
          eq(chatApprovals.threadId, input.threadId),
          eq(chatApprovals.companyId, input.companyId),
          eq(chatApprovals.status, "executing"),
          lte(chatApprovals.updatedAt, staleBefore),
        ),
      )
      .returning(approvalReturning);

    if (!claimedApproval) {
      return fetchApprovalForResponse(input);
    }
  } else {
    const [claimedApproval] = await db
      .update(chatApprovals)
      .set({
        status: "executing",
        approvedBy: input.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatApprovals.id, input.approvalId),
          eq(chatApprovals.threadId, input.threadId),
          eq(chatApprovals.companyId, input.companyId),
          eq(chatApprovals.status, "pending"),
        ),
      )
      .returning(approvalReturning);

    if (!claimedApproval) {
      return fetchApprovalForResponse(input);
    }
  }

  let artifactStatus = "approved";
  let nextApprovalPayload = asRecord(currentApproval.payload);
  let nextArtifactMetadata: Record<string, unknown> | undefined;

  try {
    if (currentApproval.action === "commit_company_db") {
      if (!currentApproval.artifactId || !currentApproval.artifactFilePath) {
        throw new Error("Approval is missing an artifact for Company-DB commit");
      }

      const normalizedApprovalPayload = normalizeCompanyDbCommitApprovalPayload(
        currentApproval.action,
        asRecord(currentApproval.payload),
      ).payload;

      const payload = companyDbCommitPayloadSchema.safeParse(normalizedApprovalPayload);
      if (!payload.success) {
        throw new Error("Approval payload is missing Company-DB commit details");
      }

      if (!payload.data.filePath.endsWith(".qmd")) {
        throw new Error("Company-DB commits currently require a .qmd target path");
      }

      const [company] = await db
        .select({
          companyDbPort: companies.companyDbPort,
        })
        .from(companies)
        .where(eq(companies.id, input.companyId))
        .limit(1);

      let companySlug: string;
      try {
        companySlug = await getCompanySlug(input.companyId);
      } catch {
        throw new Error("Company-DB is not configured for this company");
      }

      const artifactFile = await readConsultantArtifactFile({
        companyId: input.companyId,
        threadId: input.threadId,
        relativePath: currentApproval.artifactFilePath,
      });

      const commitResult = await submitCompanyDbCommit(
        companySlug,
        {
          domain: payload.data.domain,
          filePath: payload.data.filePath,
          content: artifactFile.content,
          commitMessage: payload.data.commitMessage,
          metadata: {
            ...(payload.data.metadata ?? {}),
            threadId: input.threadId,
            approvalId: input.approvalId,
            artifactId: currentApproval.artifactId,
            workspaceFilePath: currentApproval.artifactFilePath,
            artifactTitle: currentApproval.artifactTitle ?? undefined,
          },
        },
        (company?.companyDbPort ?? 3100) + 1,
      );

      artifactStatus = "committed";
      nextApprovalPayload = {
        ...normalizedApprovalPayload,
        execution: {
          type: "company_db_commit",
          domain: payload.data.domain,
          filePath: payload.data.filePath,
          commitMessage: payload.data.commitMessage,
          commitSha: commitResult.commitSha,
          committedAt: now.toISOString(),
        },
      };
      nextArtifactMetadata = {
        ...asRecord(currentApproval.artifactMetadata),
        companyDb: {
          domain: payload.data.domain,
          filePath: payload.data.filePath,
          commitSha: commitResult.commitSha,
          committedAt: now.toISOString(),
        },
      };
    } else if (isChatDirectWriteApprovalAction(currentApproval.action)) {
      const execution = await executeChatDirectWriteApproval({
        action: currentApproval.action,
        payload: currentApproval.payload,
        companyId: input.companyId,
        now,
      });
      nextApprovalPayload = {
        ...asRecord(currentApproval.payload),
        execution,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(chatApprovals)
      .set({
        status: "failed",
        payload: {
          ...asRecord(currentApproval.payload),
          execution: {
            status: "failed",
            error: errorMessage,
            failedAt: now.toISOString(),
          },
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(chatApprovals.id, input.approvalId),
          eq(chatApprovals.threadId, input.threadId),
          eq(chatApprovals.companyId, input.companyId),
          eq(chatApprovals.status, "executing"),
        ),
      );
    throw error;
  }

  const [approval] = await db.transaction(async (tx) => {
    const [updatedApproval] = await tx
      .update(chatApprovals)
      .set({
        status: "approved",
        approvedBy: input.userId,
        payload: nextApprovalPayload,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatApprovals.id, input.approvalId),
          eq(chatApprovals.threadId, input.threadId),
          eq(chatApprovals.companyId, input.companyId),
          eq(chatApprovals.status, "executing"),
        ),
      )
      .returning(approvalReturning);

    if (updatedApproval?.artifactId) {
      await tx
        .update(chatArtifacts)
        .set({
          status: artifactStatus,
          metadata: nextArtifactMetadata ?? asRecord(currentApproval.artifactMetadata),
          updatedAt: now,
        })
        .where(
          and(
            eq(chatArtifacts.id, updatedApproval.artifactId),
            eq(chatArtifacts.threadId, input.threadId),
            eq(chatArtifacts.companyId, input.companyId),
          ),
        );
    }

    return [updatedApproval] as const;
  });

  return approval ? serializeApproval(approval) : fetchApprovalForResponse(input);
}
