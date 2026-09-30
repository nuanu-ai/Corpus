import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { submitCommunicationsCommit } from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { toQmd } from "@/lib/company-db/summary/qmd";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { getPendingSignal, resolvePendingSignal } from "@/lib/communications/store";

const actionSchema = new Set(["approve", "reject"]);

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ signalId: string }> },
) {
  try {
    const auth = await getSessionCompanyContext();
    const { signalId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    if (!actionSchema.has(action)) {
      return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
    }

    const pending = await getPendingSignal(auth.companyId, signalId);
    if (!pending) {
      return NextResponse.json({ error: "Signal not found" }, { status: 404 });
    }
    if (pending.status !== "pending") {
      return NextResponse.json({ error: `Signal already ${pending.status}` }, { status: 409 });
    }

    if (action === "reject") {
      await resolvePendingSignal(auth.companyId, signalId, {
        status: "rejected",
        reviewedBy: auth.userId,
      });
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    const companySlug = await getCompanySlug(auth.companyId);
    const [companyRow] = await db
      .select({ companyDbPort: companies.companyDbPort })
      .from(companies)
      .where(eq(companies.id, auth.companyId))
      .limit(1);

    const basePort = companyRow?.companyDbPort ?? 3100;
    const content = toQmd(pending.proposedFrontmatter, pending.proposedBody);
    const commit = await submitCommunicationsCommit(
      companySlug,
      {
        domain: pending.targetDomain,
        files: [
          {
            path: pending.proposedFilePath,
            content,
          },
        ],
        commitMessage: `communications(approve): ${pending.targetDomain} ${pending.title}`,
        metadata: {
          signalId: pending.id,
          sourceThreadId: pending.sourceThreadId,
          sourceLabel: pending.sourceLabel,
        },
      },
      basePort + 1,
    );

    await resolvePendingSignal(auth.companyId, signalId, {
      status: "approved",
      reviewedBy: auth.userId,
      commitSha: commit.commitSha,
    });

    await refreshSummaryTargets({
      companySlug,
      port: basePort,
      writeQueuePort: basePort + 1,
      domains: [pending.targetDomain, "communications"],
      reason: "communications_approval",
    }).catch((error) => {
      console.warn("[communications] summary refresh after approval failed", error);
      return null;
    });

    return NextResponse.json({
      ok: true,
      status: "approved",
      commitSha: commit.commitSha,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
