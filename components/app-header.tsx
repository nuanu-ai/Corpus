"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Sun,
  Moon,
  Home,
  Files,
  MessagesSquare,
  Inbox,
  BriefcaseBusiness,
  Plug,
  Settings,
  Menu,
  LogOut,
  Building2,
  Brain,
  GitFork,
  History,
  Loader2,
  Bell,
  MessageSquareWarning,
  User,
  Bot,
  type LucideIcon,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AppCommandPalette } from "@/components/app-command-palette";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import {
  COMPANIES_CHANGED_EVENT,
  type CompaniesChangedDetail,
} from "@/lib/company-context";
import {
  PROJECTS_CHANGED_EVENT,
  type ProjectsChangedDetail,
} from "@/lib/project-context";
import { useDocumentsData } from "@/lib/hooks/use-financial-data";
import { buildDocumentQuestionFeed, type DocumentQuestionSource } from "@/lib/documents/question-feed";
import { getAppCopy } from "@/lib/i18n/copy";
import { pickPluralWord } from "@/lib/i18n/format";

const BASE_NAV_ITEMS = [
  { href: "/dashboard", labelKey: "home", icon: Home },
  { href: "/admin/company-db", labelKey: "memory", icon: Brain },
  { href: "/assistant", labelKey: "chat", icon: MessagesSquare },
  { href: "/automations", labelKey: "automations", icon: Bot },
  { href: "/integrations", labelKey: "integrations", icon: Plug },
  { href: "/admin/organization/structure", labelKey: "structure", icon: GitFork, requiresPlatformAdmin: true },
  { href: "/documents", labelKey: "history", icon: History },
] as const;

interface HeaderProject {
  id: string;
  name: string;
  role: string;
  projectKind: "company" | "personal";
}

const PERSONAL_NAV_ITEMS = [
  { href: "/personal", label: "Personal", icon: User },
  { href: "/personal/chat", label: "Chat", icon: MessagesSquare },
  { href: "/personal/documents", label: "Documents", icon: Files },
  { href: "/personal/inbox", label: "Inbox", icon: Inbox },
  { href: "/personal/workspaces", label: "Workspaces", icon: BriefcaseBusiness },
  { href: "/personal/integrations", label: "Integrations", icon: Plug },
] as const;

interface DisplayNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function AppHeader({
  children,
  primaryAction,
  userName = "User",
  userEmail,
}: {
  children?: React.ReactNode;
  primaryAction?: React.ReactNode;
  userName?: string;
  userEmail?: string;
}) {
  const locale = useLocale();
  const copy = getAppCopy(locale);
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<HeaderProject[]>([]);
  const projectsRef = useRef<HeaderProject[]>([]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectKind, setActiveProjectKind] = useState<"company" | "personal" | null>(null);
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const isPersonalRoute = pathname.startsWith("/personal");
  const navItems = useMemo<DisplayNavItem[]>(() => {
    const baseItems = isPersonalRoute || activeProjectKind === "personal"
      ? PERSONAL_NAV_ITEMS.map((item) => ({ ...item }))
      : BASE_NAV_ITEMS
          .filter(
            (item) =>
              !("requiresPlatformAdmin" in item && item.requiresPlatformAdmin) ||
              isPlatformAdmin,
          )
          .map((item) => ({
            href: item.href,
            label: copy.header.nav[item.labelKey],
            icon: item.icon,
          }));
    if (isPlatformAdmin) {
      return [
        ...baseItems,
        { href: "/admin", label: copy.header.nav.admin, icon: Building2 },
      ];
    }
    return baseItems;
  }, [activeProjectKind, copy.header.nav, isPersonalRoute, isPlatformAdmin]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const canSwitchProjects = projects.length > 1;
  const canUseCompanyPrimaryAction = !isPersonalRoute && activeProjectKind === "company";
  const shouldLoadHeaderDocumentFeed =
    !isPersonalRoute &&
    activeProjectKind !== "personal" &&
    !pathname.startsWith("/documents");
  const { data: documentRows, isLoading: isLoadingDocumentQuestions } = useDocumentsData({
    refreshIntervalMs: 0,
    limit: 50,
    enabled: shouldLoadHeaderDocumentFeed,
  });
  const documentQuestionFeed = useMemo(
    () => buildDocumentQuestionFeed(
      !shouldLoadHeaderDocumentFeed
        ? []
        : Array.isArray(documentRows)
          ? (documentRows as DocumentQuestionSource[])
          : [],
      { limit: 6 },
    ),
    [documentRows, shouldLoadHeaderDocumentFeed],
  );
  const documentRequestCountLabel = documentQuestionFeed.totalRequestCount > 9
    ? "9+"
    : String(documentQuestionFeed.totalRequestCount);
  const documentLabel = pickPluralWord(locale, documentQuestionFeed.documentCount, {
    one: locale === "ru" ? "документ" : locale === "id" ? "dokumen" : "document",
    few: "документа",
    many: "документов",
    other: locale === "id" ? "dokumen" : "documents",
  });
  const requestLabel = pickPluralWord(locale, documentQuestionFeed.totalRequestCount, {
    one: locale === "ru" ? "запрос" : locale === "id" ? "permintaan" : "request",
    few: "запроса",
    many: "запросов",
    other: locale === "id" ? "permintaan" : "requests",
  });
  const personalProjectRoleLabel =
    locale === "ru" ? "личная" : locale === "id" ? "pribadi" : "personal";

  const refreshProjects = useCallback(async () => {
    const res = await fetch("/api/projects", {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = await res.json();
    setProjects((data.projects ?? []) as HeaderProject[]);
    const nextActiveProjectId = (data.activeProjectId as string | null) ?? null;
    setActiveProjectId(nextActiveProjectId);
    const nextActiveProject = (data.projects ?? []).find(
      (project: HeaderProject) => project.id === nextActiveProjectId,
    ) as HeaderProject | undefined;
    setActiveProjectKind(nextActiveProject?.projectKind ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const projectsRes = await fetch("/api/projects", { cache: "no-store" });
        if (!mounted) return;
        if (!projectsRes.ok) return;
        const data = await projectsRes.json();
        if (!mounted) return;
        setProjects((data.projects ?? []) as HeaderProject[]);
        const nextActiveProjectId = (data.activeProjectId as string | null) ?? null;
        setActiveProjectId(nextActiveProjectId);
        const nextActiveProject = (data.projects ?? []).find(
          (project: HeaderProject) => project.id === nextActiveProjectId,
        ) as HeaderProject | undefined;
        setActiveProjectKind(nextActiveProject?.projectKind ?? null);
      } catch {
        // noop
      }
    };

    const handleCompaniesChanged = () => {
      void refreshProjects();
    };

    const handleProjectsChanged = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? (event.detail as ProjectsChangedDetail | undefined)
        : undefined;
      const changedProject = detail?.project ?? null;

      if (changedProject) {
        setProjects((current) => {
          const existing = current.find((project) => project.id === changedProject.id);
          if (existing) {
            return current.map((project) =>
              project.id === changedProject.id
                ? { ...project, ...changedProject }
                : project,
            );
          }
          return [...current, changedProject];
        });
      }

      if (detail?.activeProjectId !== undefined) {
        setActiveProjectId(detail.activeProjectId);
        const project = changedProject && changedProject.id === detail.activeProjectId
          ? changedProject
          : projectsRef.current.find((item) => item.id === detail.activeProjectId) ?? null;
        setActiveProjectKind(project?.projectKind ?? null);
      }

      void refreshProjects();
    };

    void run();
    window.addEventListener(COMPANIES_CHANGED_EVENT, handleCompaniesChanged);
    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    return () => {
      mounted = false;
      window.removeEventListener(COMPANIES_CHANGED_EVENT, handleCompaniesChanged);
      window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    };
  }, [refreshProjects]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
        });
        if (!response.ok || !mounted) {
          if (mounted) setIsPlatformAdmin(false);
          return;
        }
        const data = await response.json();
        if (mounted) {
          setIsPlatformAdmin(data?.isPlatformAdmin === true);
        }
      } catch {
        if (mounted) setIsPlatformAdmin(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  const handleSwitchProject = async (project: HeaderProject) => {
    if (project.id === activeProjectId) return;
    setIsSwitchingCompany(true);
    try {
      const res = await fetch("/api/projects/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!res.ok) return;
      setActiveProjectId(project.id);
      setActiveProjectKind(project.projectKind);
      window.dispatchEvent(
        new CustomEvent<ProjectsChangedDetail>(PROJECTS_CHANGED_EVENT, {
          detail: {
            activeProjectId: project.id,
            project,
          },
        }),
      );
      if (project.projectKind === "company") {
        window.dispatchEvent(
          new CustomEvent<CompaniesChangedDetail>(COMPANIES_CHANGED_EVENT, {
            detail: {
              activeCompanyId: project.id,
              company: {
                id: project.id,
                name: project.name,
                role: project.role,
              },
            },
          }),
        );
      }
      if (project.projectKind === "personal") {
        router.push("/personal");
      } else if (pathname.startsWith("/personal")) {
        router.push("/dashboard");
      } else {
        router.refresh();
      }
    } finally {
      setIsSwitchingCompany(false);
    }
  };

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">
              AI
            </span>
          </div>
          <h1 className="text-lg font-semibold text-foreground">Corpus</h1>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : item.href === "/admin"
                  ? pathname === "/admin"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className={`gap-1.5 text-xs ${
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
      <div className="flex items-center gap-3">
        {canUseCompanyPrimaryAction ? (
          <>
            <AppCommandPalette includeAdminStructure={isPlatformAdmin} />
            <div className="hidden md:block">{primaryAction}</div>
          </>
        ) : null}

        {/* Project selector */}
        {canSwitchProjects ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="hidden sm:flex">
              <Button variant="outline" size="sm" className="max-w-[240px] justify-start gap-2">
                {isSwitchingCompany ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                ) : activeProject?.projectKind === "personal" ? (
                  <User className="size-3.5 shrink-0" />
                ) : (
                  <Building2 className="size-3.5 shrink-0" />
                )}
                <span className="truncate text-xs">
                  {activeProject?.name ?? copy.header.company.select}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <div className="max-h-72 overflow-y-auto">
                {projects.length === 0 ? (
                  <DropdownMenuItem disabled>{copy.header.company.none}</DropdownMenuItem>
                ) : (
                  projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => handleSwitchProject(project)}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{project.name}</span>
                      {project.id === activeProjectId ? (
                        <span className="text-[10px] text-muted-foreground">{copy.header.company.active}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {project.projectKind === "personal" ? personalProjectRoleLabel : project.role}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings/companies" className="gap-2">
                  <Building2 className="size-4" />
                  {copy.header.company.manage}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="hidden max-w-[240px] items-center gap-2 truncate text-xs font-medium text-muted-foreground sm:flex">
            {activeProject?.projectKind === "personal" ? (
              <User className="size-3.5 shrink-0" />
            ) : (
              <Building2 className="size-3.5 shrink-0" />
            )}
            <span className="truncate">
              {activeProject?.name ?? copy.header.company.select}
            </span>
          </div>
        )}

        <div className="hidden md:flex">
          <LanguageSwitcher compact />
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{copy.header.actions.toggleTheme}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative">
              <Bell className="size-4" />
              {documentQuestionFeed.totalRequestCount > 0 ? (
                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-medium leading-4 text-white">
                  {documentRequestCountLabel}
                </span>
              ) : null}
              <span className="sr-only">{copy.header.actions.documentQuestions}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96">
            <div className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{copy.header.documentQuestions.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {documentQuestionFeed.documentCount > 0
                      ? locale === "ru"
                        ? `${documentQuestionFeed.documentCount} ${documentLabel} требуют input по ${documentQuestionFeed.totalRequestCount} ${requestLabel}.`
                        : locale === "id"
                          ? `${documentQuestionFeed.documentCount} ${documentLabel} membutuhkan input di ${documentQuestionFeed.totalRequestCount} ${requestLabel}.`
                          : `${documentQuestionFeed.documentCount} ${documentLabel} need input across ${documentQuestionFeed.totalRequestCount} ${requestLabel}.`
                      : copy.header.documentQuestions.empty}
                  </p>
                </div>
                {documentQuestionFeed.documentCount > 0 ? (
                <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                  <Link href="/documents#document-questions">
                    {copy.header.actions.openQueue}
                  </Link>
                </Button>
                ) : null}
              </div>
            </div>
            <DropdownMenuSeparator />
            {isLoadingDocumentQuestions && documentQuestionFeed.items.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                {copy.header.documentQuestions.loading}
              </div>
            ) : documentQuestionFeed.items.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                {copy.header.documentQuestions.pending}
              </div>
            ) : (
              documentQuestionFeed.items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="items-start gap-3 py-3"
                  onSelect={() => router.push(item.href)}
                >
                  <div className="mt-0.5 rounded-md bg-blue-500/10 p-1 text-blue-400">
                    <MessageSquareWarning className="size-3.5" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{item.fileName}</p>
                      <span className="rounded-full bg-blue-500/10 px-1.5 py-0 text-[10px] font-medium text-blue-400">
                        {item.requestCount}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
                    <p className="truncate text-[11px] text-muted-foreground/80">
                      {item.sourcePath ?? item.sourceLabel}
                    </p>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mobile hamburger menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon-sm">
              <Menu className="size-4" />
              <span className="sr-only">{copy.header.actions.menu}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium">
                {activeProject?.name ?? copy.header.company.select}
              </p>
            </div>
            <DropdownMenuSeparator />
            <div className="max-h-56 overflow-y-auto">
              {projects.length === 0 ? (
                <DropdownMenuItem disabled>{copy.header.company.none}</DropdownMenuItem>
              ) : (
                projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => handleSwitchProject(project)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {project.projectKind === "personal" ? (
                        <User className="size-4 shrink-0" />
                      ) : (
                        <Building2 className="size-4 shrink-0" />
                      )}
                      <span className="truncate">{project.name}</span>
                    </span>
                    {project.id === activeProjectId ? (
                      <span className="text-[10px] text-muted-foreground">
                        {copy.header.company.active}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {project.projectKind === "personal" ? personalProjectRoleLabel : project.role}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/companies" className="gap-2">
                <Building2 className="size-4" />
                {copy.header.company.manage}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {navItems.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} className="gap-2">
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem className="p-0 focus:bg-transparent">
              <div className="px-2 py-1.5">
                <LanguageSwitcher compact />
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="gap-2">
                <Settings className="size-4" />
                {copy.header.actions.settings}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="gap-2 text-destructive">
              <LogOut className="size-4" />
              {copy.header.actions.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User dropdown — desktop */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="hidden md:flex">
            <button className="flex items-center gap-2 rounded-full px-1 py-1 hover:bg-muted transition-colors cursor-pointer">
              <span className="text-sm text-muted-foreground">{userName}</span>
              <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-medium">
                {userName[0]?.toUpperCase() ?? "U"}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{userName}</p>
              {userEmail && (
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="gap-2">
                <Settings className="size-4" />
                {copy.header.actions.settings}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="gap-2 text-destructive">
              <LogOut className="size-4" />
              {copy.header.actions.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
