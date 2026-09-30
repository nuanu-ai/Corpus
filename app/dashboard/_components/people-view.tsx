"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Archive,
  Building2,
  GitMerge,
  Loader2,
  MessageSquareWarning,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  hasData,
  type PeopleResponse,
  type PersonProfile,
  usePeopleData,
} from "@/lib/hooks/use-financial-data";

import { EmptyState } from "@/app/dashboard/_components/empty-state";
import { ViewSkeleton } from "./view-skeleton";

type DraftState = {
  displayName: string;
  role: string;
  organization: string;
  relatedCompanies: string;
  analysisContext: string;
  crmChannels: Array<{ key: string; value: string }>;
  description: string;
  nextAction: string;
  owner: string;
  actionRequired: boolean;
};

type CreateDraftState = {
  profileKind: "contact" | "organization";
  name: string;
  displayName: string;
  role: string;
  organization: string;
  relatedCompanies: string;
  analysisContext: string;
  crmChannels: Array<{ key: string; value: string }>;
  description: string;
  nextAction: string;
  owner: string;
  actionRequired: boolean;
};

const EMPTY_CREATE_DRAFT: CreateDraftState = {
  profileKind: "contact",
  name: "",
  displayName: "",
  role: "",
  organization: "",
  relatedCompanies: "",
  analysisContext: "",
  crmChannels: [],
  description: "",
  nextAction: "",
  owner: "",
  actionRequired: false,
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildDraft(person: PersonProfile): DraftState {
  return {
    displayName: person.displayName ?? "",
    role: person.role ?? "",
    organization: person.organization ?? "",
    relatedCompanies: person.relatedCompanies.join("\n"),
    analysisContext: person.analysisContext ?? "",
    crmChannels: Object.entries(person.crmChannels).map(([key, value]) => ({ key, value })),
    description: person.manualDescription ?? person.description ?? "",
    nextAction: person.manualNextAction ?? "",
    owner: person.owner ?? "",
    actionRequired: person.manualActionRequired,
  };
}

function normalizeChannelDraft(
  rows: Array<{ key: string; value: string }>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key || !value) continue;
    next[key] = value;
  }
  return next;
}

function normalizeListDraft(value: string): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const row of value.split(/\r?\n/)) {
    const trimmed = row.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: typeof Users;
}) {
  return (
    <Card className="gap-3">
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="rounded-lg border border-border/60 bg-muted/40 p-2">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function PeopleCard({
  person,
  mergeCandidates,
  onSaved,
}: {
  person: PersonProfile;
  mergeCandidates: PersonProfile[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftState>(() => buildDraft(person));
  const [saving, setSaving] = useState(false);
  const [mergeTargetFilePath, setMergeTargetFilePath] = useState("");

  const observedChannels = Object.entries(person.observedChannels);
  const crmChannels = Object.entries(person.crmChannels);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/people", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: person.filePath,
          displayName: draft.displayName,
          role: draft.role,
          organization: draft.organization,
          relatedCompanies: normalizeListDraft(draft.relatedCompanies),
          analysisContext: draft.analysisContext,
          crmChannels: normalizeChannelDraft(draft.crmChannels),
          description: draft.description,
          nextAction: draft.nextAction,
          owner: draft.owner,
          actionRequired: draft.actionRequired,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to save (${res.status})`);
      }

      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(buildDraft(person));
    setMergeTargetFilePath("");
    setEditing(false);
  }

  async function runLifecycleAction(
    method: "PATCH" | "DELETE",
    body: Record<string, unknown>,
    message: string,
  ) {
    if (!window.confirm(message)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/people", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Failed to save (${res.status})`);
      }
      setEditing(false);
      setMergeTargetFilePath("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader className="pb-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-lg border border-border/60 bg-muted/40 p-2">
                {person.profileKind === "organization" ? (
                  <Building2 className="size-4 text-muted-foreground" />
                ) : (
                  <UserRound className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{person.displayName ?? person.name}</CardTitle>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {person.profileKind}
                  </Badge>
                  {person.actionRequired ? (
                    <Badge className="border-0 bg-amber-500/15 text-amber-400">
                      <MessageSquareWarning className="mr-1 size-3.5" />
                      Action needed
                    </Badge>
                  ) : null}
                  {person.manualDescription ? (
                    <Badge variant="outline" className="text-[10px]">
                      Edited
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {person.role ? <span>{person.role}</span> : null}
                  {person.organization ? <span>{person.organization}</span> : null}
                  {person.relatedCompanies.length > 0 ? (
                    <span>Related: {person.relatedCompanies.slice(0, 3).join(", ")}</span>
                  ) : null}
                  {person.lastInteraction ? (
                    <span>Last interaction {formatDate(person.lastInteraction)}</span>
                  ) : null}
                  {person.interactionCount ? <span>{person.interactionCount} interactions</span> : null}
                  {person.sourceMessageCount > 0 ? <span>{person.sourceMessageCount} evidence refs</span> : null}
                </div>
              </div>
            </div>
            {observedChannels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {observedChannels.map(([label, value]) => (
                  <Badge key={`${person.filePath}:${label}`} variant="secondary" className="gap-1 text-[10px]">
                    <span className="uppercase tracking-wide text-muted-foreground">observed {label}</span>
                    <span className="max-w-[240px] truncate">{value}</span>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
                  <X className="mr-1 size-3.5" />
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1 size-3.5" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 size-3.5" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editing ? (
          <>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm leading-6">
              {person.description ?? "No description recorded yet."}
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Open signals and follow-ups
                </div>
                {person.actions.length > 0 ? (
                  <div className="space-y-2">
                    {person.actions.slice(0, 3).map((action) => (
                      <div
                        key={action.id}
                        className="rounded-lg border border-border/60 bg-background/60 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{action.title}</span>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {action.kind === "manual" ? "manual" : action.targetDomain ?? "signal"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{action.summary}</p>
                        {action.sourceLabel ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Source: {action.sourceLabel}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                    No open signals or manual follow-ups linked to this profile.
                  </div>
                )}
              </div>
              <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  CRM profile
                </div>
                <div className="space-y-1 text-sm">
                  <div><span className="text-muted-foreground">Preferred name:</span> {person.displayName ?? person.name}</div>
                  <div><span className="text-muted-foreground">Role:</span> {person.role ?? "Not set"}</div>
                  <div><span className="text-muted-foreground">Organization:</span> {person.organization ?? "Not set"}</div>
                  <div><span className="text-muted-foreground">Related companies:</span> {person.relatedCompanies.length > 0 ? person.relatedCompanies.join(", ") : "Not set"}</div>
                  <div><span className="text-muted-foreground">Analysis context:</span> {person.analysisContext ?? "Not set"}</div>
                  <div><span className="text-muted-foreground">Owner:</span> {person.owner ?? "Unassigned"}</div>
                  <div><span className="text-muted-foreground">Next action:</span> {person.nextAction ?? "No follow-up recorded."}</div>
                </div>
                {crmChannels.length > 0 ? (
                  <>
                    <div className="pt-2 text-xs uppercase tracking-wide text-muted-foreground">
                      CRM contact points
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {crmChannels.map(([label, value]) => (
                        <Badge key={`${person.filePath}:crm:${label}`} variant="secondary" className="gap-1 text-[10px]">
                          <span className="uppercase tracking-wide text-muted-foreground">{label}</span>
                          <span className="max-w-[220px] truncate">{value}</span>
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : null}
                {observedChannels.length > 0 ? (
                  <>
                    <div className="pt-2 text-xs uppercase tracking-wide text-muted-foreground">
                      Observed from communications
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {observedChannels.map(([label, value]) => (
                        <Badge key={`${person.filePath}:observed:${label}`} variant="outline" className="gap-1 text-[10px]">
                          <span className="uppercase tracking-wide text-muted-foreground">{label}</span>
                          <span className="max-w-[220px] truncate">{value}</span>
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : null}
                {person.tags.length > 0 ? (
                  <>
                    <div className="pt-2 text-xs uppercase tracking-wide text-muted-foreground">
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {person.tags.map((tag) => (
                        <Badge key={`${person.filePath}:${tag}`} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <div className="grid gap-4">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
              Auto-detected identity and observed channels come from communications evidence. Editing below only changes the curated CRM layer and does not rewrite source evidence.
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Preferred name</span>
                <Input
                  value={draft.displayName}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder={person.name}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Role</span>
                <Input
                  value={draft.role}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, role: event.target.value }))
                  }
                  placeholder="Founder, counsel, landlord..."
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Organization</span>
                <Input
                  value={draft.organization}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, organization: event.target.value }))
                  }
                  placeholder="Company or counterparty"
                />
              </label>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Related companies</span>
                <textarea
                  value={draft.relatedCompanies}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, relatedCompanies: event.target.value }))
                  }
                  rows={4}
                  className="min-h-[96px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  placeholder={"One company per line. Can include companies not in Corpus."}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Analysis context</span>
                <textarea
                  value={draft.analysisContext}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, analysisContext: event.target.value }))
                  }
                  rows={4}
                  className="min-h-[96px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  placeholder="Private note added to communications analysis prompt for this person."
                />
              </label>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">CRM contact points</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      crmChannels: [...current.crmChannels, { key: "", value: "" }],
                    }))
                  }
                >
                  Add contact
                </Button>
              </div>
              <div className="space-y-2">
                {draft.crmChannels.length > 0 ? (
                  draft.crmChannels.map((row, index) => (
                    <div key={`${person.filePath}:crm-row:${index}`} className="grid gap-2 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
                      <Input
                        value={row.key}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            crmChannels: current.crmChannels.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, key: event.target.value } : item
                            ),
                          }))
                        }
                        placeholder="email, phone, telegram, whatsapp"
                      />
                      <Input
                        value={row.value}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            crmChannels: current.crmChannels.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, value: event.target.value } : item
                            ),
                          }))
                        }
                        placeholder="Value"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            crmChannels: current.crmChannels.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                    No manual CRM contact points yet. Add curated email, phone, Telegram, assistant contact, or any other label.
                  </div>
                )}
              </div>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Description</span>
              <textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                rows={5}
                className="min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Next action</span>
                <Input
                  value={draft.nextAction}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, nextAction: event.target.value }))
                  }
                  placeholder="Follow up, send proposal, review contract..."
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Owner</span>
                <Input
                  value={draft.owner}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, owner: event.target.value }))
                  }
                  placeholder="Who owns the follow-up"
                />
              </label>
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={draft.actionRequired}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    actionRequired: event.target.checked,
                  }))
                }
              />
              Mark this profile as requiring action
            </label>
            <div className="grid gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
              <div className="text-sm font-medium">Lifecycle</div>
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Merge into another profile</span>
                  <select
                    value={mergeTargetFilePath}
                    onChange={(event) => setMergeTargetFilePath(event.target.value)}
                    className="h-9 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="">Select target profile</option>
                    {mergeCandidates.map((candidate) => (
                      <option key={candidate.filePath} value={candidate.filePath}>
                        {candidate.displayName ?? candidate.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || !mergeTargetFilePath}
                  onClick={() =>
                    runLifecycleAction(
                      "PATCH",
                      {
                        action: "merge",
                        filePath: person.filePath,
                        targetFilePath: mergeTargetFilePath,
                      },
                      "Merge this profile into the selected target?",
                    )
                  }
                >
                  <GitMerge className="mr-1 size-3.5" />
                  Merge
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() =>
                    runLifecycleAction(
                      "PATCH",
                      {
                        action: "archive",
                        filePath: person.filePath,
                      },
                      "Archive this profile and hide it from the active CRM list?",
                    )
                  }
                >
                  <Archive className="mr-1 size-3.5" />
                  Archive
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() =>
                    runLifecycleAction(
                      "DELETE",
                      {
                        filePath: person.filePath,
                      },
                      "Permanently delete this profile from the system?",
                    )
                  }
                >
                  <Trash2 className="mr-1 size-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreatePeopleCard({ onCreated }: { onCreated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<CreateDraftState>(EMPTY_CREATE_DRAFT);
  const [saving, setSaving] = useState(false);

  async function createProfile() {
    setSaving(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileKind: draft.profileKind,
          name: draft.name,
          displayName: draft.displayName,
          role: draft.role,
          organization: draft.organization,
          relatedCompanies: normalizeListDraft(draft.relatedCompanies),
          analysisContext: draft.analysisContext,
          crmChannels: normalizeChannelDraft(draft.crmChannels),
          description: draft.description,
          nextAction: draft.nextAction,
          owner: draft.owner,
          actionRequired: draft.actionRequired,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create (${res.status})`);
      }

      setDraft(EMPTY_CREATE_DRAFT);
      setExpanded(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-4 border-dashed">
      <CardHeader className="pb-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base">Add to CRM</CardTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              Create a curated contact or organization manually when it should exist in CRM even if it did not come from Telegram or email.
            </div>
          </div>
          <Button
            variant={expanded ? "outline" : "default"}
            size="sm"
            onClick={() => setExpanded((current) => !current)}
          >
            <Plus className="mr-1 size-3.5" />
            {expanded ? "Close" : "Add person"}
          </Button>
        </div>
      </CardHeader>
      {expanded ? (
        <CardContent className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Profile kind</span>
              <select
                value={draft.profileKind}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    profileKind: event.target.value === "organization" ? "organization" : "contact",
                  }))
                }
                className="h-9 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="contact">Contact</option>
                <option value="organization">Organization</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder={draft.profileKind === "organization" ? "Example Real Estate" : "Jane Doe"}
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Preferred name</span>
              <Input
                value={draft.displayName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, displayName: event.target.value }))
                }
                placeholder="Optional display name"
              />
            </label>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Role</span>
              <Input
                value={draft.role}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, role: event.target.value }))
                }
                placeholder="Founder, counsel, landlord..."
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <Input
                value={draft.organization}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, organization: event.target.value }))
                }
                placeholder="Company or counterparty"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Owner</span>
              <Input
                value={draft.owner}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, owner: event.target.value }))
                }
                placeholder="Who owns this relationship"
              />
            </label>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Related companies</span>
              <textarea
                value={draft.relatedCompanies}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, relatedCompanies: event.target.value }))
                }
                rows={4}
                className="min-h-[96px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder={"One company per line. Can include companies not in Corpus."}
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Analysis context</span>
              <textarea
                value={draft.analysisContext}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, analysisContext: event.target.value }))
                }
                rows={4}
                className="min-h-[96px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="Private note added to communications analysis prompt for this person."
              />
            </label>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">CRM contact points</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    crmChannels: [...current.crmChannels, { key: "", value: "" }],
                  }))
                }
              >
                Add contact
              </Button>
            </div>
            <div className="space-y-2">
              {draft.crmChannels.length > 0 ? (
                draft.crmChannels.map((row, index) => (
                  <div key={`create-crm-row:${index}`} className="grid gap-2 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
                    <Input
                      value={row.key}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          crmChannels: current.crmChannels.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, key: event.target.value } : item
                          ),
                        }))
                      }
                      placeholder="email, phone, telegram, whatsapp"
                    />
                    <Input
                      value={row.value}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          crmChannels: current.crmChannels.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: event.target.value } : item
                          ),
                        }))
                      }
                      placeholder="Value"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          crmChannels: current.crmChannels.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                  Add curated email, phone, Telegram, WhatsApp, assistant contact, or any other relevant contact point.
                </div>
              )}
            </div>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Description</span>
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              rows={4}
              className="min-h-[100px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="Why this person or organization matters."
            />
          </label>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Next action</span>
              <Input
                value={draft.nextAction}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, nextAction: event.target.value }))
                }
                placeholder="Follow up, review contract, send proposal..."
              />
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm lg:self-end">
              <input
                type="checkbox"
                checked={draft.actionRequired}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    actionRequired: event.target.checked,
                  }))
                }
              />
              Mark this profile as requiring action
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                setDraft(EMPTY_CREATE_DRAFT);
                setExpanded(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={saving || !draft.name.trim()}
              onClick={createProfile}
            >
              {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Plus className="mr-1 size-3.5" />}
              Create profile
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function PeopleView() {
  const { data, isLoading, refetch } = usePeopleData();
  const [query, setQuery] = useState("");
  const [onlyActionNeeded, setOnlyActionNeeded] = useState(false);
  const payload: PeopleResponse = data ?? {
    data: [],
    count: 0,
    actionCount: 0,
    pendingSignalCount: 0,
    resourceCount: 0,
  };
  const hasPeople = hasData(payload.data);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return payload.data.filter((person) => {
      if (onlyActionNeeded && !person.actionRequired) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        person.name,
        person.displayName,
        person.role,
        person.organization,
        person.description,
        person.nextAction,
        person.owner,
        ...person.tags,
        ...Object.values(person.channels),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, onlyActionNeeded, payload.data]);

  if (isLoading) {
    return <ViewSkeleton variant="list" />;
  }

  const contactCount = payload.data.filter((person) => person.profileKind === "contact").length;
  return (
    <div className="space-y-4">
      <CreatePeopleCard onCreated={refetch} />

      {!hasPeople ? (
        <EmptyState
          icon={Users}
          title="No people profiles yet"
          description={
            payload.resourceCount > 0 || payload.pendingSignalCount > 0
              ? `This company currently has ${payload.resourceCount} system people resources and ${payload.pendingSignalCount} pending people signals, but no active CRM contact or organization profiles yet. Connect Telegram or email and approve the right follow-up signals, or add a curated CRM profile manually.`
              : "Connect Telegram or email and sync communications to build the CRM layer automatically, or add a curated CRM profile manually."
          }
        />
      ) : null}

      {hasPeople ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <StatCard title="Profiles" value={payload.count} icon={Users} />
            <StatCard title="Contacts" value={contactCount} icon={UserRound} />
            <StatCard title="Action Needed" value={payload.actionCount} icon={AlertCircle} />
          </div>

          <Card className="gap-4">
            <CardHeader className="pb-0">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base">People</CardTitle>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Auto-built CRM profiles from communications. Observed identity stays read-only as evidence; the edit form changes the curated CRM layer used for follow-up and decision-making.
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={refetch}>
                  <RefreshCw className="mr-1 size-3.5" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, org, handle, owner, notes..."
              />
              <Button
                variant={onlyActionNeeded ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyActionNeeded((current) => !current)}
              >
                <MessageSquareWarning className="mr-1 size-3.5" />
                {onlyActionNeeded ? "Showing actions only" : "Only action needed"}
              </Button>
            </CardContent>
          </Card>

        <div className="space-y-3">
          {filtered.map((person) => (
            <PeopleCard
              key={person.filePath}
              person={person}
              mergeCandidates={payload.data.filter(
                (candidate) =>
                  candidate.filePath !== person.filePath &&
                  candidate.profileKind === person.profileKind,
              )}
              onSaved={refetch}
            />
          ))}
        </div>
        </>
      ) : null}
    </div>
  );
}
