"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, GitCommitHorizontal, Play, RefreshCw, ShieldAlert, UploadCloud } from "lucide-react";

import type { OperatingStructureModel } from "@/lib/operating-structure/types";

type PublishPreview = {
  dryRun: boolean;
  commitSha: string | null;
  validationIssues: Array<{
    severity: string;
    code: string;
    message: string;
    objectId?: string;
    relationshipId?: string;
    companyId?: string;
  }>;
  fileCount: number;
  files: Array<{ path: string }>;
  accessEdgeMutations: Array<{
    action: string;
    parentCompanyId: string;
    childCompanyId: string;
    relationshipType: string;
    status: string;
  }>;
};

type NoteMetadata = {
  id: string;
  objectId: string;
  companyId: string | null;
  noteKind: string;
  keyVersion: string;
  updatedAt: string;
};

type StructureSnapshot = {
  model: OperatingStructureModel;
  noteMetadata: NoteMetadata[];
  publishPreview: PublishPreview;
};

const EMPTY_MANIFEST = `{
  "appCompanyMappings": [],
  "accessEdges": [],
  "companyMutations": [],
  "parentCompanyMutationApproved": false
}`;

function countMappedObjects(model: OperatingStructureModel): number {
  return model.objects.filter((object) => object.appCompanyId).length;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" }) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

export function StructureWorkbench({
  admin,
  initialSnapshot,
}: {
  admin: {
    role: string;
    rootCompanyId: string;
    rootCompanySlug: string;
  };
  initialSnapshot: StructureSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [manifestText, setManifestText] = useState(EMPTY_MANIFEST);
  const [result, setResult] = useState<PublishPreview | null>(initialSnapshot.publishPreview);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "dryRun" | "publish" | null>(null);

  const stats = useMemo(() => {
    const model = snapshot.model;
    return {
      objects: model.objects.length,
      relationships: model.relationships.length,
      mappedObjects: countMappedObjects(model),
      accessEdges: model.accessEdges.length,
      notes: snapshot.noteMetadata.length,
    };
  }, [snapshot]);

  async function refresh() {
    setBusy("refresh");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/organization/structure", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Refresh failed");
      setSnapshot({
        model: json.model,
        noteMetadata: json.noteMetadata,
        publishPreview: json.publishPreview,
      });
      setResult(json.publishPreview);
      setMessage("Snapshot refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setBusy(null);
    }
  }

  async function submit(dryRun: boolean) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      setMessage("Manifest is not valid JSON.");
      return;
    }

    setBusy(dryRun ? "dryRun" : "publish");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/organization/structure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun, manifest }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Publish request failed");
      setResult(json.result);
      setMessage(dryRun ? "Dry-run completed." : "Publish completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Publish request failed");
    } finally {
      setBusy(null);
    }
  }

  const blockingIssues = result?.validationIssues.filter((issue) => issue.severity === "error") ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-zinc-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <StatusPill tone="ok">{admin.role}</StatusPill>
            <span>{admin.rootCompanySlug}</span>
            <span className="font-mono text-xs">{admin.rootCompanyId}</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal text-zinc-950">
            Organization Structure Editor
          </h1>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy !== null}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <Metric label="Objects" value={stats.objects} />
        <Metric label="Relationships" value={stats.relationships} />
        <Metric label="Mapped" value={stats.mappedObjects} />
        <Metric label="Access Edges" value={stats.accessEdges} />
        <Metric label="Private Notes" value={stats.notes} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
        <div className="space-y-4">
          <div className="rounded-md border border-zinc-200 bg-white">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-950">Manifest Change Set</h2>
              <StatusPill tone={blockingIssues.length === 0 ? "ok" : "warn"}>
                {blockingIssues.length === 0 ? "validator clear" : `${blockingIssues.length} blocking`}
              </StatusPill>
            </div>
            <textarea
              value={manifestText}
              onChange={(event) => setManifestText(event.target.value)}
              spellCheck={false}
              className="min-h-[360px] w-full resize-y border-0 bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-50 outline-none"
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-3">
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={busy !== null}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                Dry Run
              </button>
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={busy !== null}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UploadCloud className="h-4 w-4" />
                Publish
              </button>
              {message ? <span className="text-sm text-zinc-600">{message}</span> : null}
            </div>
          </div>

          <section className="rounded-md border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-950">Operating Objects</h2>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Object</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.model.objects.slice(0, 140).map((object) => (
                    <tr key={object.id} className="border-t border-zinc-100">
                      <td className="px-4 py-2">
                        <div className="font-medium text-zinc-900">{object.canonicalName}</div>
                        <div className="font-mono text-xs text-zinc-500">{object.id}</div>
                      </td>
                      <td className="px-4 py-2 text-zinc-700">{object.objectType}</td>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-600">
                        {object.appCompanySlug ?? object.appCompanyId ?? "unmapped"}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill>{object.status}</StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-md border border-zinc-200 bg-white">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <ShieldAlert className="h-4 w-4 text-zinc-600" />
              <h2 className="text-sm font-semibold text-zinc-950">Validation</h2>
            </div>
            <div className="space-y-3 p-4">
              {result?.validationIssues.length ? (
                result.validationIssues.map((issue, index) => (
                  <div key={`${issue.code}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-amber-800">{issue.code}</span>
                      <StatusPill tone="warn">{issue.severity}</StatusPill>
                    </div>
                    <p className="mt-2 text-sm text-amber-900">{issue.message}</p>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  No validation issues.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-md border border-zinc-200 bg-white">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <GitCommitHorizontal className="h-4 w-4 text-zinc-600" />
              <h2 className="text-sm font-semibold text-zinc-950">Publish Result</h2>
            </div>
            <div className="space-y-3 p-4 text-sm text-zinc-700">
              <div className="flex justify-between gap-4">
                <span>Mode</span>
                <span className="font-medium text-zinc-950">{result?.dryRun ? "dry-run" : "publish"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Files</span>
                <span className="font-medium text-zinc-950">{result?.fileCount ?? 0}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Commit</span>
                <span className="font-mono text-xs text-zinc-950">{result?.commitSha ?? "none"}</span>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Access mutations</h3>
                <div className="space-y-2">
                  {result?.accessEdgeMutations.length ? (
                    result.accessEdgeMutations.map((mutation, index) => (
                      <div key={`${mutation.parentCompanyId}-${mutation.childCompanyId}-${index}`} className="rounded-md bg-zinc-50 p-2 font-mono text-xs">
                        {mutation.action}: {mutation.parentCompanyId} -&gt; {mutation.childCompanyId}
                      </div>
                    ))
                  ) : (
                    <p className="text-zinc-500">No access-edge mutations.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-zinc-950">{value}</div>
    </div>
  );
}
