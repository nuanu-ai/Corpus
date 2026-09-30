"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, Loader2, Save, Shield, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ConnectorRuleSummary = {
  path: string;
  exists: boolean;
  provider: string;
  policyMode: "advisory" | "mixed" | "strict";
  strict: boolean;
  notes: string | null;
  restrictionSummary: Record<string, number | boolean | string | null>;
  error?: string;
};

type ConnectorRuleDocumentState = {
  provider: string;
  label: string;
  path: string;
  exists: boolean;
  content: string;
  template: string;
  summary: ConnectorRuleSummary;
};

function formatRestrictionSummary(
  summary: Record<string, number | boolean | string | null>,
) {
  return Object.entries(summary)
    .filter(([, value]) => value !== null && value !== false && value !== 0 && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .slice(0, 4)
    .join(" · ");
}

export function ConnectorRulesEditor({
  provider,
  label,
}: {
  provider: string;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<ConnectorRuleDocumentState | null>(null);
  const [draft, setDraft] = useState("");

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/connections/providers/${provider}/rules`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to load connector rules (${response.status})`,
        );
      }

      setDocument(payload);
      setDraft(typeof payload.content === "string" ? payload.content : "");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load connector rules",
      );
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (!expanded || document) return;
    void loadRules();
  }, [document, expanded, loadRules]);

  const dirty = useMemo(() => {
    return document !== null && draft !== document.content;
  }, [document, draft]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/connections/providers/${provider}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to save connector rules (${response.status})`,
        );
      }

      setDocument(payload);
      setDraft(typeof payload.content === "string" ? payload.content : draft);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save connector rules",
      );
    } finally {
      setSaving(false);
    }
  }, [draft, provider]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/connections/providers/${provider}/rules`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to delete connector rules (${response.status})`,
        );
      }

      setDocument(payload);
      setDraft(typeof payload.content === "string" ? payload.content : "");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete connector rules",
      );
    } finally {
      setDeleting(false);
    }
  }, [provider]);

  return (
    <div className="space-y-3">
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        <FileText className="size-3.5" />
        {expanded ? "Hide rules" : "Manage rules"}
      </Button>

      {expanded ? (
        <div className="rounded-lg border border-border bg-background p-3 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading connector rules…
            </div>
          ) : document ? (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {label} rules
                  </p>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {document.summary.policyMode}
                  </Badge>
                  {document.summary.strict ? (
                    <Badge
                      variant="outline"
                      className="border-blue-500/40 bg-blue-500/10 text-blue-600"
                    >
                      <Shield className="mr-1 size-3" />
                      Strict enforcement
                    </Badge>
                  ) : null}
                  {!document.exists ? (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      Template
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{document.path}</p>
                {document.summary.notes ? (
                  <p className="text-xs text-muted-foreground">{document.summary.notes}</p>
                ) : null}
                {formatRestrictionSummary(document.summary.restrictionSummary) ? (
                  <p className="text-xs text-muted-foreground">
                    {formatRestrictionSummary(document.summary.restrictionSummary)}
                  </p>
                ) : null}
              </div>

              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-[340px] w-full rounded-md border border-border bg-muted/20 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                spellCheck={false}
              />

              {document.summary.error || error ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error ?? document.summary.error}</span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || deleting || !dirty}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save rules
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft(document.template)}
                  disabled={saving || deleting}
                >
                  Reset to template
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={saving || deleting || !document.exists}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete rules
                </Button>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              Could not load connector rules.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
