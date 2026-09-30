import { eq } from "drizzle-orm";

import { getCompanySlug } from "@/lib/company-db/tenant";
import { submitCompanyDbCommit } from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { toQmd } from "@/lib/company-db/summary/qmd";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import {
  claimReportJobArtifactForApproval,
  getReportJobArtifactForRoutine,
  releaseReportJobArtifactApprovalClaim,
  resolveReportJobArtifactReview,
} from "@/lib/report-jobs/store";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slugSegment(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function assertSafeDomain(domain: string): string {
  const normalized = domain.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error("Report artifact publish domain is invalid");
  }
  return normalized;
}

function buildPublishTarget(input: {
  domain: string;
  routineSlug: string;
  artifactId: string;
  fileName: string;
}) {
  const domain = assertSafeDomain(input.domain);
  const routineSlug = slugSegment(input.routineSlug, "routine");
  const fileBase = slugSegment(input.fileName.replace(/\.[^.]+$/, ""), "artifact");
  const artifactPart = input.artifactId.replace(/-/g, "").slice(0, 12);
  return {
    domain,
    path: `${domain}/reports/automations/${routineSlug}/${fileBase}-${artifactPart}.qmd`,
  };
}

function reportArtifactQmd(input: {
  routineId: string;
  routineSlug: string;
  routineTitle: string;
  reportJobId: string;
  artifactId: string;
  fileName: string;
  reviewedBy: string;
  body: string;
}) {
  return toQmd(
    {
      id: `report-artifact-${input.artifactId}`,
      type: "routine_report_artifact",
      title: input.fileName,
      source: "report_automation",
      routine_id: input.routineId,
      routine_slug: input.routineSlug,
      routine_title: input.routineTitle,
      report_job_id: input.reportJobId,
      artifact_id: input.artifactId,
      reviewed_by: input.reviewedBy,
      published_at: new Date().toISOString(),
    },
    input.body.trim(),
  );
}

async function getCompanyDbPorts(companyId: string) {
  const [company] = await db
    .select({ companyDbPort: companies.companyDbPort })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const basePort = company?.companyDbPort ?? 3100;
  return { restPort: basePort, writeQueuePort: basePort + 1 };
}

export async function approveReportJobArtifact(input: {
  companyId: string;
  routineId: string;
  routineSlug: string;
  routineTitle: string;
  routineDomain: string;
  jobId: string;
  artifactId: string;
  reviewedBy: string;
  reviewReason?: string | null;
}) {
  const existing = await getReportJobArtifactForRoutine({
    companyId: input.companyId,
    routineId: input.routineId,
    jobId: input.jobId,
    artifactId: input.artifactId,
  });
  if (!existing) throw new Error("Report artifact not found");

  const claimed = await claimReportJobArtifactForApproval({
    companyId: input.companyId,
    artifactId: input.artifactId,
    reviewedBy: input.reviewedBy,
  });
  if (!claimed) {
    throw new Error(`Report artifact already ${existing.reviewStatus}`);
  }

  try {
    if (claimed.kind !== "markdown") {
      throw new Error("Only markdown report artifacts can be approved for Company-DB publication");
    }
    const textContent =
      typeof claimed.metadata.textContent === "string" ? claimed.metadata.textContent.trim() : "";
    if (!textContent) {
      throw new Error("Report artifact has no markdown content to publish");
    }

    const target = buildPublishTarget({
      domain: input.routineDomain,
      routineSlug: input.routineSlug,
      artifactId: input.artifactId,
      fileName: claimed.fileName,
    });
    const companySlug = await getCompanySlug(input.companyId);
    const ports = await getCompanyDbPorts(input.companyId);
    const content = reportArtifactQmd({
      routineId: input.routineId,
      routineSlug: input.routineSlug,
      routineTitle: input.routineTitle,
      reportJobId: input.jobId,
      artifactId: input.artifactId,
      fileName: claimed.fileName,
      reviewedBy: input.reviewedBy,
      body: textContent,
    });

    const commit = await submitCompanyDbCommit(
      companySlug,
      {
        domain: target.domain,
        filePath: target.path,
        content,
        commitMessage: `report-automation(approve): ${claimed.fileName}`,
        metadata: {
          source: "report-automation",
          routineId: input.routineId,
          reportJobId: input.jobId,
          artifactId: input.artifactId,
        },
      },
      ports.writeQueuePort,
    );

    const artifact = await resolveReportJobArtifactReview({
      companyId: input.companyId,
      artifactId: input.artifactId,
      status: "approved",
      reviewedBy: input.reviewedBy,
      reviewReason: input.reviewReason,
      publishedTargetDomain: target.domain,
      publishedTargetPath: target.path,
      commitSha: commit.commitSha,
      expectedStatus: "approving",
    });
    if (!artifact) throw new Error("Report artifact approval claim was lost before finalization");

    await refreshSummaryTargets({
      companySlug,
      port: ports.restPort,
      writeQueuePort: ports.writeQueuePort,
      domains: [target.domain],
      reason: "report_artifact_approval",
    }).catch((error) => {
      console.warn("[report-jobs] summary refresh after artifact approval failed", error);
      return null;
    });

    return {
      artifact,
      commitSha: commit.commitSha,
      publishedTargetDomain: target.domain,
      publishedTargetPath: target.path,
    };
  } catch (error) {
    await releaseReportJobArtifactApprovalClaim({
      companyId: input.companyId,
      artifactId: input.artifactId,
      reviewedBy: input.reviewedBy,
      error: errorMessage(error),
    }).catch((releaseError) => {
      console.warn("[report-jobs] failed to release artifact approval claim", releaseError);
      return null;
    });
    throw error;
  }
}

export async function rejectReportJobArtifact(input: {
  companyId: string;
  routineId: string;
  jobId: string;
  artifactId: string;
  reviewedBy: string;
  reviewReason?: string | null;
}) {
  const existing = await getReportJobArtifactForRoutine({
    companyId: input.companyId,
    routineId: input.routineId,
    jobId: input.jobId,
    artifactId: input.artifactId,
  });
  if (!existing) throw new Error("Report artifact not found");
  if (existing.reviewStatus !== "pending") {
    throw new Error(`Report artifact already ${existing.reviewStatus}`);
  }
  const artifact = await resolveReportJobArtifactReview({
    companyId: input.companyId,
    artifactId: input.artifactId,
    status: "rejected",
    reviewedBy: input.reviewedBy,
    reviewReason: input.reviewReason,
    expectedStatus: "pending",
  });
  if (!artifact) throw new Error("Report artifact is no longer pending");
  return artifact;
}
