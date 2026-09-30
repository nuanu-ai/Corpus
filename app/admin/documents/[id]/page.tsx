import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminDocumentDetail } from "@/lib/admin/document-detail";
import { getPlatformAdminSession } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

function formatDate(value: Date | string | null) {
  if (!value) return "n/a";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "n/a";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "n/a";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatActor(name: string | null, email: string | null) {
  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (email) return email;
  return "system";
}

export default async function AdminDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getPlatformAdminSession();
  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  const detail = await getAdminDocumentDetail(id);
  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Document Detail</h1>
          <p className="text-sm text-muted-foreground">
            Compact operator drill-down for ingestion, dispatch, and Codex state.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin">Back to Admin</Link>
          </Button>
          {detail.company.slug ? (
            <Button variant="secondary" asChild>
              <Link href={`/admin/company-db?company=${encodeURIComponent(detail.company.slug)}`}>
                Open Company DB
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{detail.document.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {detail.company.name} · created {formatDate(detail.document.createdAt)}
                </div>
              </div>
              <Badge variant={detail.document.status === "failed" ? "destructive" : "secondary"}>
                {detail.document.status}
              </Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>Type: {formatValue(detail.document.fileType)}</div>
              <div>Source: {formatValue(detail.document.source)}</div>
              <div>Size: {formatBytes(detail.document.fileSizeBytes)}</div>
              <div>Extracted txns: {formatValue(detail.document.extractedTxnCount)}</div>
              <div>Document type: {formatValue(detail.document.documentType)}</div>
              <div>Reporting period: {formatValue(detail.document.reportingPeriod)}</div>
              <div>Confidence: {formatValue(detail.document.confidenceScore)}</div>
              <div>Company slug: {formatValue(detail.company.slug)}</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Document ID</div>
              <div className="break-all">{detail.document.id}</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">SHA-256</div>
              <div className="break-all">{detail.document.sha256}</div>
            </div>
            {detail.document.error ? (
              <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                {detail.document.error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ingress Dispatch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!detail.ingressDispatch ? (
              <p className="text-muted-foreground">No ingress dispatch state recorded.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{detail.ingressDispatch.stage}</Badge>
                  <Badge variant="secondary">
                    strategy {detail.ingressDispatch.processingStrategy ?? "n/a"}
                  </Badge>
                  <Badge variant="secondary">
                    target {detail.ingressDispatch.dispatchTarget ?? "n/a"}
                  </Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>Dispatch event: {formatValue(detail.ingressDispatch.dispatchEvent)}</div>
                  <div>Language: {formatValue(detail.ingressDispatch.language)}</div>
                  <div>Routing confidence: {formatValue(detail.ingressDispatch.routingConfidence)}</div>
                  <div>Extraction confidence: {formatValue(detail.ingressDispatch.extractionConfidence)}</div>
                  <div>OCR needed: {formatValue(detail.ingressDispatch.ocrNeeded)}</div>
                  <div>Table density: {formatValue(detail.ingressDispatch.tableDensity)}</div>
                  <div>Updated at: {formatValue(detail.ingressDispatch.updatedAt)}</div>
                </div>
                {detail.ingressDispatch.reasons.length > 0 ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {detail.ingressDispatch.reasons.map((reason) => (
                      <Badge key={reason} variant="secondary">
                        {reason}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {detail.ingressDispatch.error ? (
                  <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                    {detail.ingressDispatch.error}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Action Eligibility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">Review</div>
                  <div className="text-xs text-muted-foreground">
                    Mirrors `/api/documents/[id]/review` status gate.
                  </div>
                </div>
                <Badge variant={detail.actionEligibility.review.eligible ? "secondary" : "outline"}>
                  {detail.actionEligibility.review.eligible ? "eligible" : "not eligible"}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {detail.actionEligibility.review.availableActions.length > 0 ? (
                  detail.actionEligibility.review.availableActions.map((action) => (
                    <Badge key={action} variant="secondary">
                      {action}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">no actions available</Badge>
                )}
                {detail.actionEligibility.review.reasons.map((reason) => (
                  <Badge key={reason} variant="outline">
                    {reason}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">Reprocess</div>
                  <div className="text-xs text-muted-foreground">
                    Mirrors `/api/documents/[id]/reprocess` readiness checks.
                  </div>
                </div>
                <Badge variant={detail.actionEligibility.reprocess.eligible ? "secondary" : "outline"}>
                  {detail.actionEligibility.reprocess.eligible ? "eligible" : "not eligible"}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div>Mode: {formatValue(detail.actionEligibility.reprocess.mode)}</div>
                <div>Effective status: {formatValue(detail.actionEligibility.reprocess.effectiveStatus)}</div>
                <div>Effective source: {formatValue(detail.actionEligibility.reprocess.effectiveSource)}</div>
                <div>
                  Stored original: {formatValue(detail.actionEligibility.reprocess.canUseStoredOriginal)}
                </div>
                <div>
                  Google Drive redownload: {formatValue(
                    detail.actionEligibility.reprocess.canRedownloadFromGoogleDrive,
                  )}
                </div>
                <div>
                  Targets parent: {formatValue(detail.actionEligibility.reprocess.targetsParentDocument)}
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-border p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">Effective document</div>
                <div className="break-all">
                  {detail.actionEligibility.reprocess.effectiveFileName} ·{" "}
                  {detail.actionEligibility.reprocess.effectiveDocumentId}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {detail.actionEligibility.reprocess.reasons.map((reason) => (
                  <Badge key={reason} variant="outline">
                    {reason}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Codex Preprocess</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!detail.codexPreprocess ? (
              <p className="text-muted-foreground">No Codex preprocess state recorded.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{detail.codexPreprocess.stage}</Badge>
                  <Badge variant="secondary">
                    pool {detail.codexPreprocess.pool ?? "n/a"}
                  </Badge>
                  <Badge variant="secondary">
                    attempts {detail.codexPreprocess.attempts}
                  </Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>Model: {formatValue(detail.codexPreprocess.model)}</div>
                  <div>Updated at: {formatValue(detail.codexPreprocess.updatedAt)}</div>
                  <div>Completed at: {formatValue(detail.codexPreprocess.completedAt)}</div>
                  <div>Artifacts: {formatValue(detail.codexPreprocess.artifactCount)}</div>
                  <div>Units: {formatValue(detail.codexPreprocess.unitCount)}</div>
                  <div>Import root: {formatValue(detail.codexPreprocess.importRootPath)}</div>
                </div>
                {detail.codexPreprocess.error ? (
                  <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                    {detail.codexPreprocess.error}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Codex Promotion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!detail.codexPromotion ? (
              <p className="text-muted-foreground">No Codex promotion state recorded.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{detail.codexPromotion.stage}</Badge>
                  {detail.codexPromotion.promotedDomains.map((domain) => (
                    <Badge key={domain} variant="secondary">
                      {domain}
                    </Badge>
                  ))}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>Completed at: {formatValue(detail.codexPromotion.completedAt)}</div>
                  <div>Reports staged: {formatValue(detail.codexPromotion.reportStagingCount)}</div>
                  <div>Canonical finance staged: {formatValue(detail.codexPromotion.canonicalFinanceStagingCount)}</div>
                  <div>Transactions staged: {formatValue(detail.codexPromotion.transactionStagingCount)}</div>
                  <div>Non-financial staged: {formatValue(detail.codexPromotion.nonFinancialStagingCount)}</div>
                  <div>
                    Classification kind: {formatValue(
                      (detail.codexPromotion.classification as Record<string, unknown> | null | undefined)
                        ?.document_kind,
                    )}
                  </div>
                  <div>
                    Classification confidence: {formatValue(
                      (detail.codexPromotion.classification as Record<string, unknown> | null | undefined)
                        ?.confidence,
                    )}
                  </div>
                </div>
                {detail.codexPromotion.error ? (
                  <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                    {detail.codexPromotion.error}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Codex Audit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!detail.codexAudit ? (
              <p className="text-muted-foreground">No Codex audit state recorded.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{detail.codexAudit.stage}</Badge>
                  {detail.codexAudit.overallStatus ? (
                    <Badge variant={detail.codexAudit.overallStatus === "fail" ? "destructive" : "secondary"}>
                      {detail.codexAudit.overallStatus}
                    </Badge>
                  ) : null}
                  {detail.codexAudit.recommendedDisposition ? (
                    <Badge variant="outline">{detail.codexAudit.recommendedDisposition}</Badge>
                  ) : null}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>Completed at: {formatValue(detail.codexAudit.completedAt)}</div>
                  <div>Model: {formatValue(detail.codexAudit.model)}</div>
                  <div>Artifact count: {formatValue(detail.codexAudit.artifactCount)}</div>
                  <div>Company-DB artifacts: {formatValue(detail.codexAudit.companyDbArtifactCount)}</div>
                  <div>Issue count: {formatValue(detail.codexAudit.issueCount)}</div>
                  <div>Warning count: {formatValue(detail.codexAudit.warningCount)}</div>
                </div>
                {detail.codexAudit.auditSummary ? (
                  <div className="rounded-lg border border-border p-3 text-sm">
                    {detail.codexAudit.auditSummary}
                  </div>
                ) : null}
                {detail.codexAudit.result?.issues?.length ? (
                  <div className="space-y-2">
                    {detail.codexAudit.result.issues.slice(0, 5).map((issue) => (
                      <div key={`${issue.code}:${issue.evidence}`} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={issue.severity === "high" ? "destructive" : "secondary"}>
                            {issue.severity}
                          </Badge>
                          <Badge variant="outline">{issue.code}</Badge>
                        </div>
                        <div className="mt-2 font-medium">{issue.issue}</div>
                        <div className="mt-1 text-muted-foreground">{issue.impact}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{issue.evidence}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {detail.codexAudit.error ? (
                  <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                    {detail.codexAudit.error}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Recent Audit Trail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {detail.recentAuditEntries.length === 0 ? (
              <p className="text-muted-foreground">No recent audit entries for this document.</p>
            ) : (
              detail.recentAuditEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium">{entry.action}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatActor(entry.actorName, entry.actorEmail)} · {formatDate(entry.createdAt)}
                      </div>
                    </div>
                    <Badge variant={entry.error ? "destructive" : "secondary"}>
                      {entry.error ? "error" : "ok"}
                    </Badge>
                  </div>
                  {entry.summaryItems.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {entry.summaryItems.map((item) => (
                        <Badge key={`${entry.id}:${item.label}:${item.value}`} variant="secondary">
                          {item.label} {item.value}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {entry.error ? (
                    <div className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                      {entry.error}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
