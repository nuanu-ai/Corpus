"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Search,
  Settings,
  User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COMPANIES_CHANGED_EVENT,
  type CompaniesChangedDetail,
} from "@/lib/company-context";
import {
  PROJECTS_CHANGED_EVENT,
  type ProjectsChangedDetail,
} from "@/lib/project-context";
import { cn } from "@/lib/utils";

interface Project {
  id: string;
  name: string;
  role: string;
  projectKind: "company" | "personal";
  slug: string | null;
}

interface ProjectsResponse {
  projects: Project[];
  activeProjectId: string | null;
}

const MY_COMPANIES_COPY = {
  en: {
    workspaceBadge: "Workspaces",
    title: "My companies",
    subtitle: "Quickly switch between companies and your personal workspace.",
    allSettings: "All settings",
    searchPlaceholder: "Find a company",
    loading: "Loading companies...",
    empty: "You do not have any available companies yet.",
    activeSection: "Currently open",
    companiesSection: "Companies",
    noSearchResults: "No companies match this search.",
    personalSection: "Personal workspace",
    personalType: "My workspace",
    companyType: "Company",
    personalRole: "personal",
    activeBadge: "Active",
    openCurrent: "Open",
    openAction: "Open",
    loadError: "Failed to load companies",
    switchError: "Failed to switch company",
  },
  ru: {
    workspaceBadge: "Рабочие зоны",
    title: "Мои компании",
    subtitle: "Быстро переключайтесь между компаниями и личной рабочей зоной.",
    allSettings: "Все настройки",
    searchPlaceholder: "Найти компанию",
    loading: "Загружаем компании...",
    empty: "У вас пока нет доступных компаний.",
    activeSection: "Сейчас открыто",
    companiesSection: "Компании",
    noSearchResults: "По этому поиску компаний нет.",
    personalSection: "Личная зона",
    personalType: "Моя рабочая зона",
    companyType: "Компания",
    personalRole: "личная",
    activeBadge: "Активна",
    openCurrent: "Открыта",
    openAction: "Открыть",
    loadError: "Не удалось загрузить компании",
    switchError: "Не удалось переключить компанию",
  },
  id: {
    workspaceBadge: "Workspace",
    title: "Perusahaan saya",
    subtitle: "Beralih cepat antara perusahaan dan workspace pribadi.",
    allSettings: "Semua pengaturan",
    searchPlaceholder: "Cari perusahaan",
    loading: "Memuat perusahaan...",
    empty: "Belum ada perusahaan yang tersedia.",
    activeSection: "Sedang dibuka",
    companiesSection: "Perusahaan",
    noSearchResults: "Tidak ada perusahaan untuk pencarian ini.",
    personalSection: "Workspace pribadi",
    personalType: "Workspace saya",
    companyType: "Perusahaan",
    personalRole: "pribadi",
    activeBadge: "Aktif",
    openCurrent: "Terbuka",
    openAction: "Buka",
    loadError: "Gagal memuat perusahaan",
    switchError: "Gagal mengganti perusahaan",
  },
} as const;

function getMyCompaniesCopy(locale: string) {
  if (locale === "ru") return MY_COMPANIES_COPY.ru;
  if (locale === "id") return MY_COMPANIES_COPY.id;
  return MY_COMPANIES_COPY.en;
}

function projectTypeLabel(project: Project, copy: ReturnType<typeof getMyCompaniesCopy>): string {
  return project.projectKind === "personal" ? copy.personalType : copy.companyType;
}

function projectRoleLabel(project: Project, copy: ReturnType<typeof getMyCompaniesCopy>): string {
  return project.projectKind === "personal" ? copy.personalRole : project.role;
}

export function MyCompaniesScreen() {
  const router = useRouter();
  const locale = useLocale();
  const copy = getMyCompaniesCopy(locale);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`${copy.loadError} (${response.status})`);
      }
      const payload = (await response.json()) as ProjectsResponse;
      setProjects(payload.projects ?? []);
      setActiveProjectId(payload.activeProjectId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) =>
      [project.name, project.slug, project.role, projectTypeLabel(project, copy)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [copy, projects, query]);

  const companyProjects = filteredProjects.filter((project) => project.projectKind === "company");
  const personalProject = filteredProjects.find((project) => project.projectKind === "personal") ?? null;

  const switchProject = async (project: Project) => {
    if (project.id === activeProjectId) return;
    setSwitchingProjectId(project.id);
    setError(null);
    try {
      const response = await fetch("/api/projects/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!response.ok) {
        throw new Error(`${copy.switchError} (${response.status})`);
      }

      setActiveProjectId(project.id);
      window.dispatchEvent(
        new CustomEvent<ProjectsChangedDetail>(PROJECTS_CHANGED_EVENT, {
          detail: {
            activeProjectId: project.id,
            project,
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent<CompaniesChangedDetail>(COMPANIES_CHANGED_EVENT, {
          detail: {
            activeCompanyId: project.projectKind === "company" ? project.id : null,
            company:
              project.projectKind === "company"
                ? {
                    id: project.id,
                    name: project.name,
                    role: project.role,
                  }
                : null,
          },
        }),
      );

      if (project.projectKind === "personal") {
        router.push("/personal");
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.switchError);
    } finally {
      setSwitchingProjectId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <Building2 className="size-3.5" />
          {copy.workspaceBadge}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {copy.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {copy.subtitle}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
            <Link href="/settings">
              <Settings className="size-4" />
              {copy.allSettings}
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {copy.loading}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/60 px-4 py-5 text-sm text-muted-foreground">
          {copy.empty}
        </div>
      ) : (
        <>
          {activeProject ? (
            <section className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {copy.activeSection}
              </h2>
              <ProjectRow
                project={activeProject}
                copy={copy}
                active
                switching={switchingProjectId === activeProject.id}
                onSwitch={() => switchProject(activeProject)}
              />
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {copy.companiesSection}
            </h2>
            {companyProjects.length === 0 ? (
              <div className="rounded-lg border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
                {copy.noSearchResults}
              </div>
            ) : (
              <div className="space-y-2">
                {companyProjects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    copy={copy}
                    active={project.id === activeProjectId}
                    switching={switchingProjectId === project.id}
                    onSwitch={() => switchProject(project)}
                  />
                ))}
              </div>
            )}
          </section>

          {personalProject ? (
            <section className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {copy.personalSection}
              </h2>
              <ProjectRow
                project={personalProject}
                copy={copy}
                active={personalProject.id === activeProjectId}
                switching={switchingProjectId === personalProject.id}
                onSwitch={() => switchProject(personalProject)}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  copy,
  active,
  switching,
  onSwitch,
}: {
  project: Project;
  copy: ReturnType<typeof getMyCompaniesCopy>;
  active: boolean;
  switching: boolean;
  onSwitch: () => void;
}) {
  const Icon = project.projectKind === "personal" ? User : Building2;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card/70 p-3",
        active ? "border-primary/50" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
            active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium">{project.name}</div>
            {active ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{projectTypeLabel(project, copy)}</Badge>
            <Badge variant="outline">{projectRoleLabel(project, copy)}</Badge>
            {active ? <Badge>{copy.activeBadge}</Badge> : null}
          </div>
          {project.slug ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">{project.slug}</div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end">
        <Button
          size="sm"
          variant={active ? "secondary" : "default"}
          disabled={active || switching}
          onClick={onSwitch}
          className="min-w-28"
        >
          {switching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : active ? (
            copy.openCurrent
          ) : (
            <>
              {copy.openAction}
              <ChevronRight className="size-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
