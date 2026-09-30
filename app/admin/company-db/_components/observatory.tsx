"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import {
  Database,
  GitCommit,
  FolderTree,
  Flame,
  AlertCircle,
  Building2,
  Layers,
  Search,
  Clock3,
  Download,
  X,
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CommitHeatmap } from "./commit-heatmap";
import { CommitLog } from "./commit-log";
import { FileTree } from "./file-tree";
import { deriveEntitySourceProvenance } from "@/lib/company-db/provenance";
import type {
  StatsResponse,
  EntityResult,
  CommitLogEntry,
} from "@/lib/company-db/client";

interface Company {
  id: string;
  name: string;
  slug: string | null;
  role: string;
}

interface InitialData {
  stats: StatsResponse;
  entities: {
    data: EntityResult[];
    count: number;
    truncated: boolean;
    hasMore: boolean;
    offset: number;
    limit: number;
  };
}

interface CommitsData {
  data: CommitLogEntry[];
  count: number;
}

interface FilePreviewResponse {
  path: string;
  content: string;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "n/a";
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return "n/a";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function absoluteTime(dateStr: string | null): string {
  if (!dateStr) return "n/a";
  const ts = new Date(dateStr);
  if (Number.isNaN(ts.getTime())) return "n/a";
  return ts.toISOString();
}

function percent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

const ENTITY_PAGE_SIZE = 200;

export function CompanyDbObservatory({
  companies,
  selectedSlug: selectedSlugProp,
}: {
  companies: Company[];
  selectedSlug?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const eligibleCompanies = companies.filter((c) => c.slug);

  const [selectedSlug, setSelectedSlug] = useState<string>(
    eligibleCompanies.find((company) => company.slug === selectedSlugProp)?.slug ??
      eligibleCompanies[0]?.slug ??
      "",
  );
  const [data, setData] = useState<InitialData | null>(null);
  const [commits, setCommits] = useState<CommitsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [loadingMoreEntities, setLoadingMoreEntities] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [previewEntity, setPreviewEntity] = useState<EntityResult | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isDeletingCompany, setIsDeletingCompany] = useState(false);

  const selectedCompany = useMemo(
    () => eligibleCompanies.find((c) => c.slug === selectedSlug),
    [eligibleCompanies, selectedSlug],
  );
  const canDeleteCompany = Boolean(
    selectedCompany && (selectedCompany.role === "owner" || isPlatformAdmin),
  );
  const previewProvenance = useMemo(
    () => (previewEntity ? deriveEntitySourceProvenance(previewEntity) : null),
    [previewEntity],
  );

  const fetchData = useCallback(async (
    slug: string,
    options?: { append?: boolean; offset?: number },
  ) => {
    const append = options?.append ?? false;
    const offset = options?.offset ?? 0;

    if (append) {
      setLoadingMoreEntities(true);
    } else {
      setLoading(true);
      setError(null);
      setData(null);
    }

    try {
      const params = new URLSearchParams({
        limit: String(ENTITY_PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`/api/admin/company-db/${slug}?${params.toString()}`);
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "Request failed" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json: InitialData = await res.json();
      if (append) {
        setData((prev) => {
          if (!prev) return json;
          const combinedData = [...prev.entities.data, ...json.entities.data];
          return {
            ...json,
            entities: {
              ...json.entities,
              data: combinedData,
              offset: 0,
              truncated: combinedData.length < json.entities.count,
              hasMore: combinedData.length < json.entities.count,
            },
          };
        });
      } else {
        setData(json);
      }
    } catch (err) {
      if (append) {
        toast(err instanceof Error ? err.message : "Failed to load more entities", {
          variant: "error",
        });
      } else {
        setError(err instanceof Error ? err.message : "Failed to load data");
      }
    } finally {
      if (append) {
        setLoadingMoreEntities(false);
      } else {
        setLoading(false);
      }
    }
  }, [toast]);

  const fetchCommits = useCallback(async (slug: string) => {
    setCommitsLoading(true);
    setCommits(null);

    try {
      const res = await fetch(
        `/api/admin/company-db/${slug}/commits?limit=20&offset=0`,
      );
      if (!res.ok) return;
      const json: CommitsData = await res.json();
      setCommits(json);
    } catch {
      // Commits are non-critical; silently fail
    } finally {
      setCommitsLoading(false);
    }
  }, []);

  const loadMoreCommits = useCallback(async () => {
    if (!commits || !selectedSlug) return;

    setLoadingMoreCommits(true);
    try {
      const offset = commits.data.length;
      const res = await fetch(
        `/api/admin/company-db/${selectedSlug}/commits?limit=20&offset=${offset}`,
      );
      if (!res.ok) return;
      const json: CommitsData = await res.json();
      setCommits((prev) =>
        prev ? { data: [...prev.data, ...json.data], count: json.count } : json,
      );
    } catch {
      // Non-critical; silently fail
    } finally {
      setLoadingMoreCommits(false);
    }
  }, [commits, selectedSlug]);

  const loadMoreEntities = useCallback(async () => {
    if (!data?.entities.hasMore || !selectedSlug) return;
    await fetchData(selectedSlug, {
      append: true,
      offset: data.entities.data.length,
    });
  }, [data?.entities.data.length, data?.entities.hasMore, fetchData, selectedSlug]);

  const closePreview = useCallback(() => {
    setPreviewEntity(null);
    setPreviewContent("");
    setPreviewLoading(false);
    setPreviewError(null);
  }, []);

  const openFilePreview = useCallback(async (entity: EntityResult) => {
    if (!selectedSlug) return;

    setPreviewEntity(entity);
    setPreviewContent("");
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const url = `/api/admin/company-db/${selectedSlug}/file?path=${encodeURIComponent(entity.filePath)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Preview request failed" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json: FilePreviewResponse = await res.json();
      setPreviewContent(json.content ?? "");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load file preview");
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedSlug]);

  const downloadPreviewFile = useCallback(() => {
    if (!selectedSlug || !previewEntity) return;

    const url = `/api/admin/company-db/${selectedSlug}/file?path=${encodeURIComponent(previewEntity.filePath)}&download=1`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [previewEntity, selectedSlug]);

  useEffect(() => {
    if (!selectedSlugProp) return;
    if (!eligibleCompanies.some((company) => company.slug === selectedSlugProp)) return;
    setSelectedSlug(selectedSlugProp);
  }, [eligibleCompanies, selectedSlugProp]);

  useEffect(() => {
    setDeleteConfirmName("");
  }, [selectedCompany?.id]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/session", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setIsPlatformAdmin(Boolean(data?.isPlatformAdmin));
      })
      .catch(() => {
        if (cancelled) return;
        setIsPlatformAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    setQuery("");
    setDomainFilter("all");
    closePreview();
    fetchData(selectedSlug);
    fetchCommits(selectedSlug);
  }, [selectedSlug, fetchData, fetchCommits, closePreview]);

  useEffect(() => {
    if (!previewEntity) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePreview();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewEntity, closePreview]);

  const domains = useMemo(() => {
    if (!data) return [] as Array<[string, number]>;
    return Object.entries(data.stats.domains).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const typeCounts = useMemo(() => {
    if (!data) return [] as Array<[string, number]>;
    const counts = new Map<string, number>();
    for (const entity of data.entities.data) {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filteredEntities = useMemo(() => {
    if (!data) return [] as EntityResult[];
    const q = query.trim().toLowerCase();
    return data.entities.data.filter((entity) => {
      if (domainFilter !== "all" && entity.domain !== domainFilter) {
        return false;
      }
      if (!q) return true;
      return (
        entity.filePath.toLowerCase().includes(q) ||
        entity.type.toLowerCase().includes(q) ||
        entity.domain.toLowerCase().includes(q) ||
        (entity.title ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query, domainFilter]);

  const recentEntities = useMemo(() => {
    const activityTs = (entity: EntityResult) => {
      const raw = entity.updatedAt ?? entity.createdAt ?? null;
      if (!raw) return 0;
      const ts = new Date(raw).getTime();
      return Number.isFinite(ts) ? ts : 0;
    };

    return [...filteredEntities]
      .sort((a, b) => {
        return activityTs(b) - activityTs(a);
      })
      .slice(0, 8);
  }, [filteredEntities]);

  const promptText = useMemo(() => {
    if (!selectedCompany || !data) return "";

    const lines: string[] = [
      `You are analyzing the Company-DB snapshot for "${selectedCompany.name}" (slug: ${selectedSlug}).`,
      "",
      "Use this snapshot to understand what data exists, what is missing, what the repository currently contains, and what follow-up questions or actions make sense.",
      "",
      "Company",
      `- name: ${selectedCompany.name}`,
      `- slug: ${selectedSlug}`,
      `- role: ${selectedCompany.role || "n/a"}`,
      "",
      "Snapshot Stats",
      `- total entities: ${data.stats.totalEntities}`,
      `- loaded entities in admin view: ${data.entities.data.length}`,
      `- filtered entities in current view: ${filteredEntities.length}`,
      `- total commits: ${data.stats.totalCommits}`,
      `- domain count: ${domains.length}`,
      `- last commit sha: ${data.stats.lastCommit?.sha ?? "n/a"}`,
      `- last commit message: ${data.stats.lastCommit?.message ?? "n/a"}`,
      `- last commit date: ${absoluteTime(data.stats.lastCommit?.date ?? null)}`,
    ];

    if (data.entities.truncated) {
      lines.push(
        `- note: entity list is truncated in this admin response; only ${data.entities.data.length} loaded entities are available client-side out of ${data.entities.count} returned by the endpoint`,
      );
    }

    lines.push(
      "",
      "Current UI Filters",
      `- search query: ${query.trim() || "(none)"}`,
      `- domain filter: ${domainFilter}`,
      "",
      "Domains",
    );

    if (domains.length === 0) {
      lines.push("- none");
    } else {
      for (const [domain, count] of domains) {
        lines.push(`- ${domain}: ${count}`);
      }
    }

    lines.push("", "Top Entity Types");
    if (typeCounts.length === 0) {
      lines.push("- none");
    } else {
      for (const [type, count] of typeCounts.slice(0, 20)) {
        lines.push(`- ${type}: ${count}`);
      }
    }

    lines.push("", "Recent Entities In Current View");
    if (recentEntities.length === 0) {
      lines.push("- none");
    } else {
      for (const entity of recentEntities) {
        lines.push(
          `- [${entity.domain}/${entity.type}] ${entity.title || entity.filePath} | path: ${entity.filePath} | status: ${entity.status ?? "n/a"} | updated: ${absoluteTime(entity.updatedAt ?? entity.createdAt)}`,
        );
      }
    }

    lines.push("", "Loaded Entities In Current View");
    if (filteredEntities.length === 0) {
      lines.push("- none");
    } else {
      for (const entity of filteredEntities) {
        lines.push(
          `- [${entity.domain}/${entity.type}] ${entity.filePath} | title: ${entity.title ?? "n/a"} | status: ${entity.status ?? "n/a"} | created: ${absoluteTime(entity.createdAt)} | updated: ${absoluteTime(entity.updatedAt ?? entity.createdAt)}`,
        );
      }
    }

    lines.push("", "Recent Commits");
    if (!commits || commits.data.length === 0) {
      lines.push("- none loaded");
    } else {
      for (const commit of commits.data) {
        lines.push(
          `- ${commit.sha.slice(0, 7)} | ${absoluteTime(commit.date)} | ${commit.author} | files changed: ${commit.filesChanged} | ${commit.message}`,
        );
      }
    }

    return lines.join("\n");
  }, [
    commits,
    data,
    domainFilter,
    domains,
    filteredEntities,
    query,
    recentEntities,
    selectedCompany,
    selectedSlug,
    typeCounts,
  ]);

  const copyPrompt = useCallback(async () => {
    if (!promptText) return;
    await navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    window.setTimeout(() => setCopiedPrompt(false), 2000);
  }, [promptText]);

  const deleteSelectedCompany = useCallback(async () => {
    if (!selectedCompany || !canDeleteCompany) return;

    const confirmName = deleteConfirmName.trim();
    if (confirmName !== selectedCompany.name) {
      toast("Company name confirmation does not match.", { variant: "error" });
      return;
    }

    setIsDeletingCompany(true);
    try {
      const res = await fetch(`/api/companies/${selectedCompany.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Failed to delete company");
      }

      const nextCompany = eligibleCompanies.find(
        (company) => company.id !== selectedCompany.id && company.slug,
      );
      toast(`Deleted company "${selectedCompany.name}".`, { variant: "success" });
      closePreview();
      router.replace(
        nextCompany?.slug
          ? `/admin/company-db?company=${encodeURIComponent(nextCompany.slug)}`
          : "/admin/company-db",
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete company", {
        variant: "error",
      });
    } finally {
      setIsDeletingCompany(false);
    }
  }, [
    canDeleteCompany,
    closePreview,
    deleteConfirmName,
    eligibleCompanies,
    router,
    selectedCompany,
    toast,
  ]);

  if (eligibleCompanies.length === 0) {
    return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto w-full max-w-6xl min-w-0">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Database className="mb-4 size-12 text-muted-foreground" />
              <h2 className="mb-2 text-lg font-semibold">No Company Databases</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                No companies with a configured slug were found. Company-DB
                requires a slug to identify the git repository.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background p-4 md:p-6">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
              <Layers className="size-3.5" />
              Company Knowledge Map
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Understand what your company is made of
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Explore domains, entity types, file structure, and change history for the active company.
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <ArrowLeft className="size-4" />
                Back to Dashboard
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyPrompt}
              disabled={loading || !data}
            >
              {copiedPrompt ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copiedPrompt ? "Copied Prompt" : "Copy All As Prompt"}
            </Button>
            {selectedCompany ? (
              <div className="min-w-0 max-w-full rounded-md border border-border/70 bg-card/60 px-3 py-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground break-words">
                  {selectedCompany.name}
                </span>
                <span className="ml-2 hidden lg:inline">
                  from the global company selector
                </span>
              </div>
            ) : null}
            {selectedCompany?.role && (
              <Badge variant="outline" className="capitalize">
                {selectedCompany.role}
              </Badge>
            )}
          </div>
        </div>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertCircle className="size-5 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <StatsGridSkeleton />
        ) : data ? (
          <StatsGrid
            stats={data.stats}
            entityCount={data.entities.count}
            domainCount={domains.length}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderTree className="size-4" />
              Repository Structure
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : data ? (
              <FileTree
                entities={filteredEntities}
                totalCount={data.entities.count}
                truncated={data.entities.truncated && filteredEntities.length === data.entities.data.length}
                hasMore={data.entities.hasMore && filteredEntities.length === data.entities.data.length}
                loadingMore={loadingMoreEntities}
                onLoadMore={loadMoreEntities}
                onFileClick={openFilePreview}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="size-4" />
              Company Composition
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid gap-6 md:grid-cols-2">
                <Skeleton className="h-[220px] w-full" />
                <Skeleton className="h-[220px] w-full" />
              </div>
            ) : data ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Domains
                  </p>
                  {domains.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No domains found yet.
                    </p>
                  )}
                  {domains.map(([domain, count]) => {
                    const max = domains[0]?.[1] ?? 1;
                    const width = percent(count, max);
                    return (
                      <div key={domain} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{domain}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {count}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Top Entity Types
                  </p>
                  {typeCounts.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No entity types found yet.
                    </p>
                  )}
                  {typeCounts.slice(0, 10).map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-medium">{type}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Search className="size-4" />
              What&apos;s Inside
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by file path, title, type, or domain"
              />
              <Select value={domainFilter} onValueChange={setDomainFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All domains" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All domains</SelectItem>
                  {domains.map(([domain]) => (
                    <SelectItem key={domain} value={domain}>
                      {domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {query.trim() || domainFilter !== "all"
                  ? `Showing ${filteredEntities.length} matches from ${data?.entities.data.length ?? 0} loaded of ${data?.entities.count ?? 0} total entities`
                  : `Loaded ${data?.entities.data.length ?? 0} of ${data?.entities.count ?? 0} total entities`}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" />
                Updated or created recently
              </span>
            </div>

            {data?.entities.hasMore && !query.trim() && domainFilter === "all" ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={loadMoreEntities}
                  disabled={loadingMoreEntities}
                >
                  {loadingMoreEntities ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Load more entities
                </Button>
              </div>
            ) : null}

            <div className="grid gap-2">
              {recentEntities.length === 0 && (
                <p className="rounded-md border border-border/60 bg-secondary/20 px-3 py-4 text-sm text-muted-foreground">
                  No entities match the current filters.
                </p>
              )}
              {recentEntities.map((entity) => (
                <div
                  key={entity.qualifiedId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-secondary/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {entity.title || entity.filePath}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entity.filePath}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{entity.domain}</Badge>
                    <span>{relativeTime(entity.updatedAt ?? entity.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Flame className="size-4" />
              Change Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[120px] w-full" />
            ) : data ? (
              <CommitHeatmap
                heatmap={data.stats.heatmap}
                totalCommits={data.stats.totalCommits}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitCommit className="size-4" />
              Commit Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            {commitsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : commits ? (
              <CommitLog
                commits={commits.data}
                totalCount={commits.count}
                onLoadMore={loadMoreCommits}
                loadingMore={loadingMoreCommits}
              />
            ) : null}
          </CardContent>
        </Card>

        {selectedCompany && canDeleteCompany ? (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm text-destructive">
                <Trash2 className="size-4" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Permanently delete <span className="font-medium text-foreground">{selectedCompany.name}</span>,
                its Company-DB artifacts, chat state, documents, staging records,
                and connector registrations. This cannot be undone.
              </p>
              <div className="flex flex-col gap-3 md:flex-row">
                <Input
                  value={deleteConfirmName}
                  onChange={(event) => setDeleteConfirmName(event.target.value)}
                  placeholder={`Type "${selectedCompany.name}" to confirm`}
                  disabled={isDeletingCompany}
                />
                <Button
                  type="button"
                  variant="destructive"
                  onClick={deleteSelectedCompany}
                  disabled={
                    isDeletingCompany || deleteConfirmName.trim() !== selectedCompany.name
                  }
                >
                  {isDeletingCompany ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete company
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Available to company owners and platform admins. After deletion,
                the admin view will redirect to the next available company.
              </p>
            </CardContent>
          </Card>
        ) : null}

      </div>

      {previewEntity && (
        <div className="fixed inset-0 z-50 bg-black/50 p-4">
          <div
            className="absolute inset-0"
            onClick={closePreview}
            aria-hidden="true"
          />
          <div className="relative mx-auto flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={previewEntity.filePath}>
                  {previewEntity.filePath}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{previewEntity.domain}</Badge>
                  <Badge variant="outline">{previewEntity.type}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={downloadPreviewFile}
                  disabled={previewLoading}
                >
                  <Download className="size-4" />
                  Download
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={closePreview}
                  aria-label="Close preview"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            {previewProvenance ? (
              <div className="border-b border-border px-4 py-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Source provenance
                      </p>
                      {previewProvenance.originalDocument ? (
                        <div className="mt-1 space-y-1 text-sm">
                          <p className="font-medium">
                            {previewProvenance.originalDocument.fileName ?? "Original source file"}
                          </p>
                          <p className="break-all text-xs text-muted-foreground">
                            document id: {previewProvenance.originalDocument.documentId}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-1 space-y-1 text-sm text-muted-foreground">
                          <p>No single original document is attached to this artifact.</p>
                          {previewProvenance.sourceFileCount || previewProvenance.sourceEntityCount ? (
                            <p>
                              Derived from{" "}
                              {previewProvenance.sourceFileCount
                                ? `${previewProvenance.sourceFileCount} source files`
                                : "multiple source files"}
                              {previewProvenance.sourceEntityCount
                                ? ` across ${previewProvenance.sourceEntityCount} entities`
                                : ""}.
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {previewProvenance.evidenceStatus ? (
                        <Badge variant="outline">
                          evidence {previewProvenance.evidenceStatus}
                        </Badge>
                      ) : null}
                      {previewProvenance.reviewPending === true ? (
                        <Badge variant="outline">review pending</Badge>
                      ) : null}
                      {previewProvenance.reviewPending === false ? (
                        <Badge variant="outline">review cleared</Badge>
                      ) : null}
                      {previewProvenance.ingestionMode ? (
                        <Badge variant="outline">
                          mode {previewProvenance.ingestionMode}
                        </Badge>
                      ) : null}
                    </div>

                    {previewProvenance.ingestionReason ? (
                      <p className="text-xs text-muted-foreground">
                        {previewProvenance.ingestionReason}
                      </p>
                    ) : null}
                  </div>

                  {previewProvenance.originalDocument ? (
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button asChild type="button" size="sm" variant="secondary">
                        <Link
                          href={previewProvenance.originalDocument.adminPath}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open document record
                        </Link>
                      </Button>
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link
                          href={previewProvenance.originalDocument.viewPath}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open original
                        </Link>
                      </Button>
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link
                          href={previewProvenance.originalDocument.downloadPath}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download original
                        </Link>
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="min-h-[220px] flex-1 overflow-auto p-4">
              {previewLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : previewError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {previewError}
                </div>
              ) : (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-secondary/20 p-3 text-xs leading-5">
                  {previewContent || "File is empty."}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-secondary/30 p-2">
          <Icon className="size-4 text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatsGrid({
  stats,
  entityCount,
  domainCount,
}: {
  stats: StatsResponse;
  entityCount: number;
  domainCount: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Entities"
        value={String(entityCount)}
        hint="Total mapped records"
        icon={Database}
      />
      <StatCard
        title="Domains"
        value={String(domainCount)}
        hint="Business areas covered"
        icon={FolderTree}
      />
      <StatCard
        title="Commits"
        value={String(stats.totalCommits)}
        hint="Repository change count"
        icon={GitCommit}
      />
      <StatCard
        title="Last Change"
        value={relativeTime(stats.lastCommit?.date ?? null)}
        hint={stats.lastCommit?.sha?.slice(0, 7) ?? "No commits yet"}
        icon={Clock3}
      />
    </div>
  );
}

function StatsGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[100px] w-full" />
      ))}
    </div>
  );
}
