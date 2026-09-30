"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BriefcaseBusiness,
  Loader2,
  RefreshCcw,
  Save,
  Send,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PROJECTS_CHANGED_EVENT,
  type ProjectsChangedDetail,
} from "@/lib/project-context";

interface PersonalWorkspaceCard {
  companyId: string;
  companyName: string;
  companySlug: string | null;
  role: string;
  summary: string | null;
  noteBody: string;
  waitingFors: string[];
  mirrorSummary: string | null;
  mirrorRefreshedAt: string | null;
  publishedFilePath: string | null;
  publishedAt: string | null;
}

interface WorkspaceDraftState {
  noteBody: string;
  waitingFors: string;
}

export function PersonalWorkspacesView({
  workspaces,
}: {
  workspaces: PersonalWorkspaceCard[];
}) {
  const router = useRouter();
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [savingCompanyId, setSavingCompanyId] = useState<string | null>(null);
  const [publishingCompanyId, setPublishingCompanyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, WorkspaceDraftState>>(
    () =>
      Object.fromEntries(
        workspaces.map((workspace) => [
          workspace.companyId,
          {
            noteBody: workspace.noteBody ?? "",
            waitingFors: workspace.waitingFors.join("\n"),
          },
        ]),
      ),
  );

  async function openWorkspace(workspace: PersonalWorkspaceCard, href: string) {
    const projectId = workspace.companyId;
    setPendingProjectId(projectId);
    try {
      const response = await fetch("/api/projects/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to switch workspace (${response.status})`);
      }

      const payload = (await response.json()) as {
        activeProjectId?: string;
        project?: {
          id: string;
          name: string;
          role: string;
          projectKind: "company" | "personal";
        };
      };
      const project = payload.project ?? {
        id: workspace.companyId,
        name: workspace.companyName,
        role: workspace.role,
        projectKind: "company" as const,
      };

      window.dispatchEvent(
        new CustomEvent<ProjectsChangedDetail>(PROJECTS_CHANGED_EVENT, {
          detail: {
            activeProjectId: payload.activeProjectId ?? projectId,
            project,
          },
        }),
      );

      router.push(href);
      router.refresh();
    } finally {
      setPendingProjectId(null);
    }
  }

  function setDraft(companyId: string, patch: Partial<WorkspaceDraftState>) {
    setDrafts((current) => ({
      ...current,
      [companyId]: {
        noteBody: patch.noteBody ?? current[companyId]?.noteBody ?? "",
        waitingFors: patch.waitingFors ?? current[companyId]?.waitingFors ?? "",
      },
    }));
  }

  async function saveWorkspace(companyId: string, refreshMirror = false) {
    const draft = drafts[companyId] ?? { noteBody: "", waitingFors: "" };
    setSavingCompanyId(companyId);
    setFeedback((current) => ({ ...current, [companyId]: "" }));

    try {
      const response = await fetch(`/api/personal/workspaces/${encodeURIComponent(companyId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteBody: draft.noteBody,
          waitingFors: draft.waitingFors
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          refreshMirror,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to save workspace note (${response.status})`,
        );
      }

      const mirrorUpdated =
        typeof payload.mirrorUpdated === "boolean" ? payload.mirrorUpdated : false;
      const mirrorWarning =
        typeof payload.mirrorWarning === "string" && payload.mirrorWarning.trim().length > 0
          ? payload.mirrorWarning.trim()
          : null;
      setFeedback((current) => ({
        ...current,
        [companyId]:
          refreshMirror
            ? mirrorWarning
              ? `Saved note. ${mirrorWarning}`
              : mirrorUpdated
              ? "Saved note and refreshed mirror."
              : "Saved note, but the live company mirror could not be refreshed."
            : "Saved personal workspace note.",
      }));
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [companyId]:
          error instanceof Error ? error.message : "Failed to save personal workspace note.",
      }));
    } finally {
      setSavingCompanyId(null);
    }
  }

  async function publishWorkspace(companyId: string) {
    const draft = drafts[companyId] ?? { noteBody: "", waitingFors: "" };
    setPublishingCompanyId(companyId);
    setFeedback((current) => ({ ...current, [companyId]: "" }));

    try {
      const response = await fetch(
        `/api/personal/workspaces/${encodeURIComponent(companyId)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noteBody: draft.noteBody,
            waitingFors: draft.waitingFors
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to publish workspace note (${response.status})`,
        );
      }

      setFeedback((current) => ({
        ...current,
        [companyId]: "Published note into the linked company workspace.",
      }));
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [companyId]:
          error instanceof Error ? error.message : "Failed to publish workspace note.",
      }));
    } finally {
      setPublishingCompanyId(null);
    }
  }

  if (workspaces.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BriefcaseBusiness className="size-4" />
            Linked workspaces
          </CardTitle>
          <CardDescription>No linked company memberships are available from this account.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {workspaces.map((workspace) => {
        const isPending = pendingProjectId === workspace.companyId;
        const isSaving = savingCompanyId === workspace.companyId;
        const isPublishing = publishingCompanyId === workspace.companyId;
        const draft = drafts[workspace.companyId] ?? {
          noteBody: workspace.noteBody ?? "",
          waitingFors: workspace.waitingFors.join("\n"),
        };

        return (
          <Card key={workspace.companyId}>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{workspace.companyName}</CardTitle>
                <Badge variant="secondary">{workspace.role}</Badge>
                {workspace.companySlug ? (
                  <Badge variant="outline">{workspace.companySlug}</Badge>
                ) : null}
              </div>
              <CardDescription>
                Linked company workspace. Open it explicitly when you need live company truth.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border/70 bg-card/50 p-4 text-sm leading-6 text-muted-foreground">
                {workspace.summary?.trim().length
                  ? workspace.summary
                  : "No company summary has been materialized yet for this workspace."}
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium">Cached personal mirror</div>
                  {workspace.mirrorRefreshedAt ? (
                    <Badge variant="outline">
                      {new Date(workspace.mirrorRefreshedAt).toLocaleString()}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Not mirrored yet</Badge>
                  )}
                </div>
                <div className="text-sm leading-6 text-muted-foreground">
                  {workspace.mirrorSummary?.trim().length
                    ? workspace.mirrorSummary
                    : "No cached company mirror in your personal project yet. Refresh mirror to pin the latest company summary into personal storage."}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 bg-card/50 p-4">
                <div className="text-sm font-medium">Workspace note</div>
                <textarea
                  value={draft.noteBody}
                  onChange={(event) =>
                    setDraft(workspace.companyId, { noteBody: event.target.value })
                  }
                  rows={6}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Private operating note for this linked company workspace."
                />

                <div className="text-sm font-medium">Waiting fors</div>
                <textarea
                  value={draft.waitingFors}
                  onChange={(event) =>
                    setDraft(workspace.companyId, { waitingFors: event.target.value })
                  }
                  rows={4}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={"One open loop per line\nNeed lease answer from legal\nWaiting for monthly numbers"}
                />

                {workspace.publishedAt ? (
                  <div className="text-xs text-muted-foreground">
                    Last published {new Date(workspace.publishedAt).toLocaleString()}
                    {workspace.publishedFilePath ? ` · ${workspace.publishedFilePath}` : ""}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void openWorkspace(workspace, "/dashboard")}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 size-4" />
                  )}
                  Open dashboard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void openWorkspace(workspace, "/assistant")}
                  disabled={isPending}
                >
                  Open company chat
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void openWorkspace(workspace, "/documents")}
                  disabled={isPending}
                >
                  Open documents
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void saveWorkspace(workspace.companyId, false)}
                  disabled={isSaving || isPublishing}
                >
                  {isSaving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}
                  Save note
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void saveWorkspace(workspace.companyId, true)}
                  disabled={isSaving || isPublishing}
                >
                  <RefreshCcw className="mr-2 size-4" />
                  Refresh mirror
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void publishWorkspace(workspace.companyId)}
                  disabled={isSaving || isPublishing}
                >
                  {isPublishing ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 size-4" />
                  )}
                  Publish to company
                </Button>
              </div>

              {feedback[workspace.companyId] ? (
                <div className="text-sm text-muted-foreground">{feedback[workspace.companyId]}</div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
