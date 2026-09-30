"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import { Building2, Copy, Loader2, Plus, Shield, SlidersHorizontal, Trash2, Users } from "lucide-react";
import { COMPANIES_CHANGED_EVENT, type CompaniesChangedDetail } from "@/lib/company-context";
import { PROJECTS_CHANGED_EVENT, type ProjectsChangedDetail } from "@/lib/project-context";

interface Project {
  id: string;
  name: string;
  slug: string | null;
  role: string;
  projectKind: "company" | "personal";
  schemaPack: "company" | "person";
  projectDbPort: number;
  joinedAt: string;
  companyDescription?: string | null;
}

interface ProjectsResponse {
  projects: Project[];
  activeProjectId: string | null;
}

interface CompetitorSeed {
  name: string;
  website: string | null;
  note: string | null;
}

interface BusinessProfileAdditionsDraft {
  marketResearchSummary?: string | null;
  targetMarkets?: string[];
  customerSegments?: string[];
  productLines?: string[];
  competitorSeeds?: CompetitorSeed[];
  notes?: string | null;
}

interface Member {
  userId: string;
  role: string;
  joinedAt: string;
  name: string;
  email: string;
}

type DomainAccessLevel = "metadata" | "read" | "file" | "write" | "admin";
type DomainDraftValue = DomainAccessLevel | "none";

interface DomainGrant {
  id: string;
  domain: string;
  accessLevel: DomainAccessLevel;
  source: string;
  approvedByUserId: string | null;
  approvedAt: string;
}

interface DomainGrantMember {
  userId: string;
  role: string;
  name: string;
  email: string;
  grants: DomainGrant[];
}

const MANAGER_ROLES = new Set(["owner", "admin"]);
const ASSIGNABLE_ROLES = [
  "member",
  "admin",
  "viewer",
  "cfo_agent",
  "external_accountant",
  "investor_view",
  "partner_agent",
  "owner",
] as const;

const COMPANY_DOMAIN_OPTIONS = [
  { domain: "*", label: "All domains" },
  { domain: "identity", label: "Identity" },
  { domain: "finance", label: "Finance" },
  { domain: "banking", label: "Banking" },
  { domain: "legal", label: "Legal" },
  { domain: "tax", label: "Tax" },
  { domain: "governance", label: "Governance" },
  { domain: "operations", label: "Operations" },
  { domain: "documents", label: "Documents" },
  { domain: "entities", label: "Entities" },
  { domain: "knowledge", label: "Knowledge" },
  { domain: "strategy", label: "Strategy" },
  { domain: "projects", label: "Projects" },
  { domain: "products", label: "Products" },
  { domain: "people", label: "People" },
  { domain: "communications", label: "Communications" },
  { domain: "revenue", label: "Revenue" },
  { domain: "expenses", label: "Expenses" },
  { domain: "market", label: "Market" },
  { domain: "assets", label: "Assets" },
  { domain: "inventory", label: "Inventory" },
  { domain: "bookings", label: "Bookings" },
  { domain: "integrations", label: "Integrations" },
  { domain: "security", label: "Security" },
] as const;

const DOMAIN_ACCESS_OPTIONS: Array<{ value: DomainDraftValue; label: string }> = [
  { value: "none", label: "None" },
  { value: "metadata", label: "Metadata" },
  { value: "read", label: "Read" },
  { value: "file", label: "Files" },
  { value: "write", label: "Write" },
  { value: "admin", label: "Admin" },
];

const COMPANIES_TAB_COPY = {
  en: {
    companiesTitle: "Companies",
    companiesDescription: "Switch between companies and your personal workspace.",
    newCompany: "New company",
    agentDescription: "Description for agents",
    create: "Create",
    loadingCompanies: "Loading companies...",
    emptyCompanies: "No companies yet.",
    active: "Active",
    inactive: "Inactive",
    profile: "Profile",
    access: "Access",
    makeActive: "Make active",
    tableCompany: "Company",
    tableType: "Type",
    tableRole: "Role",
    tableStatus: "Status",
    tableActions: "Actions",
    companyProfile: "Company profile",
    companyContext: (name: string) => `Context agents use for ${name}.`,
    personalProfileManagedSeparately: "Personal workspace is managed separately.",
    selectCompanyFirst: "Select a company first.",
    companyNotSelected: "No company selected.",
    personalAutoManaged:
      "Personal workspace is created automatically. Its profile and linked companies will live on separate personal screens.",
    needOwnerAdminProfile: "You need the `owner` or `admin` role to edit company profile.",
    companyName: "Company name",
    website: "Website",
    businessType: "Business type",
    jurisdiction: "Jurisdiction",
    entityType: "Entity type",
    contextHint:
      "This text goes into agent context and should describe the business with stable facts.",
    reportingCurrency: "Reporting currency",
    currencyHint: "ISO 4217 code: USD, IDR, EUR. Used as fallback and dashboard currency.",
    parentCompany: "Parent company",
    noParent: "None, top level",
    parentHint: "Groups this company under a holding so agents can answer roll-up questions.",
    aliases: "Aliases",
    add: "Add",
    aliasesEmpty:
      "No aliases yet. They help agents connect abbreviations and legal names to this company.",
    manualMarketContext: "Manual market context",
    marketResearchSummary: "Market research summary",
    targetMarkets: "Target markets",
    customerSegments: "Customer segments",
    productLines: "Product lines",
    competitorSeeds: "Competitor seeds",
    marketContextNotes: "Notes",
    saveProfile: "Save profile",
    selectedCompanyLinkPlaceholder: "Select a company to get its link",
    selectedCompanyLinkHint:
      "Use this link when the ChatGPT app should be bound to one company.",
    selectedCompanyLinkEmpty:
      "Select a company above to copy its company-scoped ChatGPT app URL.",
    companyAccessTitle: "Company access",
    companyAccessDescription: (name: string) => `User access to ${name}.`,
    personalNotShared: "Personal workspace is not shared yet.",
    personalOwnerOnly: "Personal workspace is currently available only to its owner.",
    needOwnerAdminAccess: "You need the `owner` or `admin` role to manage access.",
    userEmail: "User email",
    role: "Role",
    addAccess: "Add access",
    informationDomains: "Information domains",
    accessLevels: "Levels: metadata, read, files, write, admin.",
    loadingUsers: "Loading users...",
    noUsers: "This company has no users yet.",
    remove: "Remove",
    domainAccessTitle: "Information domain access",
    domainAccessDescription:
      "Limits Company-DB, chat, MCP, and report jobs for this user.",
    roleFullAccess:
      "Owner/admin receive full domain access by role. Use member/viewer/cfo_agent for limited access.",
    activeCompanyRequired:
      "Domain grants API works on the active company. Make this company active to edit domains.",
    loadingDomainGrants: "Loading domain grants...",
    saveDomains: "Save domains",
    personalDeleteDisabled: "Deleting personal workspaces is disabled for now.",
    personalDeleteLifecycleDisabled:
      "Deleting personal workspaces is disabled until export/data lifecycle is ready.",
    projectKindPersonal: "My workspace",
    projectKindCompany: "Company",
    fullAccessByRole: "Full access by role",
    noDomainAccess: "No domain access",
    allDomains: "All domains",
    noAccess: "None",
    metadataAccess: "Metadata",
    readAccess: "Read",
    fileAccess: "Files",
    writeAccess: "Write",
    adminAccess: "Admin",
  },
  ru: {
    companiesTitle: "Компании",
    companiesDescription: "Переключайтесь между компаниями и личной рабочей зоной.",
    newCompany: "Новая компания",
    agentDescription: "Описание для агентов",
    create: "Создать",
    loadingCompanies: "Загружаем компании...",
    emptyCompanies: "Компаний пока нет.",
    active: "Активна",
    inactive: "Неактивна",
    profile: "Профиль",
    access: "Доступы",
    makeActive: "Сделать активной",
    tableCompany: "Компания",
    tableType: "Тип",
    tableRole: "Роль",
    tableStatus: "Статус",
    tableActions: "Действия",
    companyProfile: "Профиль компании",
    companyContext: (name: string) => `Контекст, который агенты используют для ${name}.`,
    personalProfileManagedSeparately: "Личная рабочая зона управляется отдельно.",
    selectCompanyFirst: "Сначала выберите компанию.",
    companyNotSelected: "Компания не выбрана.",
    personalAutoManaged:
      "Личная рабочая зона создается автоматически. Ее профиль и связанные компании будут на отдельных personal-экранах.",
    needOwnerAdminProfile: "Нужна роль `owner` или `admin`, чтобы менять профиль компании.",
    companyName: "Название компании",
    website: "Сайт",
    businessType: "Тип бизнеса",
    jurisdiction: "Юрисдикция",
    entityType: "Тип юрлица",
    contextHint:
      "Этот текст попадает в agent context и должен описывать бизнес устойчивыми фактами.",
    reportingCurrency: "Валюта отчетности",
    currencyHint:
      "ISO 4217 код: USD, IDR, EUR. Используется как fallback и валюта дашбордов.",
    parentCompany: "Родительская компания",
    noParent: "Нет, верхний уровень",
    parentHint:
      "Группирует компанию под холдингом, чтобы agents могли делать roll-up запросы.",
    aliases: "Алиасы",
    add: "Добавить",
    aliasesEmpty:
      "Алиасов пока нет. Они помогают agents связывать сокращения и юр. названия с этой компанией.",
    manualMarketContext: "Ручной рыночный контекст",
    marketResearchSummary: "Сводка research",
    targetMarkets: "Целевые рынки",
    customerSegments: "Сегменты клиентов",
    productLines: "Продуктовые линии",
    competitorSeeds: "Конкуренты",
    marketContextNotes: "Заметки",
    saveProfile: "Сохранить профиль",
    selectedCompanyLinkPlaceholder: "Выберите компанию, чтобы получить ссылку для нее",
    selectedCompanyLinkHint:
      "Используйте эту ссылку, когда ChatGPT app должен быть привязан к одной компании.",
    selectedCompanyLinkEmpty:
      "Выберите компанию выше, чтобы скопировать ее company-scoped ChatGPT app URL.",
    companyAccessTitle: "Доступы компании",
    companyAccessDescription: (name: string) => `Доступ пользователей к ${name}.`,
    personalNotShared: "Личная рабочая зона пока не шарится.",
    personalOwnerOnly: "Личная рабочая зона пока доступна только владельцу.",
    needOwnerAdminAccess: "Нужна роль `owner` или `admin`, чтобы управлять доступами.",
    userEmail: "Email пользователя",
    role: "Роль",
    addAccess: "Добавить доступ",
    informationDomains: "Домены информации",
    accessLevels: "Уровни: метаданные, чтение, файлы, запись, админ.",
    loadingUsers: "Загружаем пользователей...",
    noUsers: "В этой компании пока нет пользователей.",
    remove: "Убрать",
    domainAccessTitle: "Доступ к доменам информации",
    domainAccessDescription:
      "Ограничивает Company-DB, чат, MCP и report jobs для этого пользователя.",
    roleFullAccess:
      "Owner/admin получают полный доменный доступ по роли. Для ограниченного доступа используйте роль member/viewer/cfo_agent.",
    activeCompanyRequired:
      "Domain grants API работает по активной компании. Сделайте эту компанию активной, чтобы менять домены.",
    loadingDomainGrants: "Загружаем domain grants...",
    saveDomains: "Сохранить домены",
    personalDeleteDisabled: "Удаление личной рабочей зоны пока отключено.",
    personalDeleteLifecycleDisabled:
      "Удаление личной рабочей зоны отключено до готовности export/data lifecycle.",
    projectKindPersonal: "Моя зона",
    projectKindCompany: "Компания",
    fullAccessByRole: "Полный доступ по роли",
    noDomainAccess: "Нет доменного доступа",
    allDomains: "Все домены",
    noAccess: "Нет",
    metadataAccess: "Метаданные",
    readAccess: "Чтение",
    fileAccess: "Файлы",
    writeAccess: "Запись",
    adminAccess: "Админ",
  },
  id: {
    companiesTitle: "Perusahaan",
    companiesDescription: "Beralih antara perusahaan dan workspace pribadi.",
    newCompany: "Perusahaan baru",
    agentDescription: "Deskripsi untuk agent",
    create: "Buat",
    loadingCompanies: "Memuat perusahaan...",
    emptyCompanies: "Belum ada perusahaan.",
    active: "Aktif",
    inactive: "Tidak aktif",
    profile: "Profil",
    access: "Akses",
    makeActive: "Jadikan aktif",
    tableCompany: "Perusahaan",
    tableType: "Tipe",
    tableRole: "Peran",
    tableStatus: "Status",
    tableActions: "Aksi",
    companyProfile: "Profil perusahaan",
    companyContext: (name: string) => `Konteks yang digunakan agent untuk ${name}.`,
    personalProfileManagedSeparately: "Workspace pribadi dikelola terpisah.",
    selectCompanyFirst: "Pilih perusahaan dahulu.",
    companyNotSelected: "Perusahaan belum dipilih.",
    personalAutoManaged:
      "Workspace pribadi dibuat otomatis. Profil dan perusahaan terkait akan ada di layar personal terpisah.",
    needOwnerAdminProfile: "Perlu role `owner` atau `admin` untuk mengubah profil perusahaan.",
    companyName: "Nama perusahaan",
    website: "Website",
    businessType: "Tipe bisnis",
    jurisdiction: "Yurisdiksi",
    entityType: "Tipe badan hukum",
    contextHint:
      "Teks ini masuk ke agent context dan harus menjelaskan bisnis dengan fakta stabil.",
    reportingCurrency: "Mata uang laporan",
    currencyHint: "Kode ISO 4217: USD, IDR, EUR. Dipakai sebagai fallback dan mata uang dashboard.",
    parentCompany: "Perusahaan induk",
    noParent: "Tidak ada, level atas",
    parentHint:
      "Mengelompokkan perusahaan di bawah holding agar agent bisa menjawab pertanyaan roll-up.",
    aliases: "Alias",
    add: "Tambah",
    aliasesEmpty:
      "Belum ada alias. Alias membantu agent menghubungkan singkatan dan nama legal ke perusahaan ini.",
    manualMarketContext: "Konteks pasar manual",
    marketResearchSummary: "Ringkasan riset pasar",
    targetMarkets: "Pasar target",
    customerSegments: "Segmen pelanggan",
    productLines: "Lini produk",
    competitorSeeds: "Seed kompetitor",
    marketContextNotes: "Catatan",
    saveProfile: "Simpan profil",
    selectedCompanyLinkPlaceholder: "Pilih perusahaan untuk mendapatkan link",
    selectedCompanyLinkHint:
      "Gunakan link ini jika ChatGPT app harus terikat ke satu perusahaan.",
    selectedCompanyLinkEmpty:
      "Pilih perusahaan di atas untuk menyalin URL ChatGPT app khusus perusahaan.",
    companyAccessTitle: "Akses perusahaan",
    companyAccessDescription: (name: string) => `Akses pengguna ke ${name}.`,
    personalNotShared: "Workspace pribadi belum dibagikan.",
    personalOwnerOnly: "Workspace pribadi saat ini hanya tersedia untuk pemiliknya.",
    needOwnerAdminAccess: "Perlu role `owner` atau `admin` untuk mengelola akses.",
    userEmail: "Email pengguna",
    role: "Role",
    addAccess: "Tambah akses",
    informationDomains: "Domain informasi",
    accessLevels: "Level: metadata, baca, file, tulis, admin.",
    loadingUsers: "Memuat pengguna...",
    noUsers: "Perusahaan ini belum memiliki pengguna.",
    remove: "Hapus",
    domainAccessTitle: "Akses domain informasi",
    domainAccessDescription:
      "Membatasi Company-DB, chat, MCP, dan report jobs untuk pengguna ini.",
    roleFullAccess:
      "Owner/admin mendapat akses domain penuh melalui role. Gunakan member/viewer/cfo_agent untuk akses terbatas.",
    activeCompanyRequired:
      "Domain grants API bekerja pada perusahaan aktif. Jadikan perusahaan ini aktif untuk mengubah domain.",
    loadingDomainGrants: "Memuat domain grants...",
    saveDomains: "Simpan domain",
    personalDeleteDisabled: "Penghapusan workspace pribadi sementara dinonaktifkan.",
    personalDeleteLifecycleDisabled:
      "Penghapusan workspace pribadi dinonaktifkan sampai export/data lifecycle siap.",
    projectKindPersonal: "Workspace saya",
    projectKindCompany: "Perusahaan",
    fullAccessByRole: "Akses penuh dari role",
    noDomainAccess: "Tidak ada akses domain",
    allDomains: "Semua domain",
    noAccess: "Tidak ada",
    metadataAccess: "Metadata",
    readAccess: "Baca",
    fileAccess: "File",
    writeAccess: "Tulis",
    adminAccess: "Admin",
  },
} as const;

function getCompaniesTabCopy(locale: string) {
  if (locale === "ru") return COMPANIES_TAB_COPY.ru;
  if (locale === "id") return COMPANIES_TAB_COPY.id;
  return COMPANIES_TAB_COPY.en;
}

function accessLevelLabel(value: DomainDraftValue, copy: ReturnType<typeof getCompaniesTabCopy>): string {
  switch (value) {
    case "metadata":
      return copy.metadataAccess;
    case "read":
      return copy.readAccess;
    case "file":
      return copy.fileAccess;
    case "write":
      return copy.writeAccess;
    case "admin":
      return copy.adminAccess;
    case "none":
    default:
      return copy.noAccess;
  }
}

function domainLabel(domain: string, fallback: string, copy: ReturnType<typeof getCompaniesTabCopy>): string {
  return domain === "*" ? copy.allDomains : fallback;
}

function projectKindLabel(kind: Project["projectKind"], copy: ReturnType<typeof getCompaniesTabCopy>): string {
  return kind === "personal" ? copy.projectKindPersonal : copy.projectKindCompany;
}

function domainGrantSummary(
  member: DomainGrantMember | undefined,
  role: string,
  copy: ReturnType<typeof getCompaniesTabCopy>,
): string {
  if (role === "owner" || role === "admin") return copy.fullAccessByRole;
  if (!member || member.grants.length === 0) return copy.noDomainAccess;
  const wildcard = member.grants.find((grant) => grant.domain === "*");
  if (wildcard) return `${copy.allDomains}: ${accessLevelLabel(wildcard.accessLevel, copy)}`;
  return member.grants
    .slice(0, 4)
    .map((grant) => `${grant.domain}: ${accessLevelLabel(grant.accessLevel, copy)}`)
    .join(", ") + (member.grants.length > 4 ? "..." : "");
}

function draftFromGrants(grants: DomainGrant[]): Record<string, DomainDraftValue> {
  const draft: Record<string, DomainDraftValue> = {};
  for (const option of COMPANY_DOMAIN_OPTIONS) {
    draft[option.domain] = "none";
  }
  for (const grant of grants) {
    draft[grant.domain] = grant.accessLevel;
  }
  return draft;
}

function splitDraftList(value: string): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value.split(/[,\n]/)) {
    const text = item.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(text.slice(0, 120));
    if (normalized.length >= 32) break;
  }
  return normalized;
}

function joinDraftList(values: unknown): string {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string").join(", ")
    : "";
}

function serializeCompetitorSeeds(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const seed = item as Partial<CompetitorSeed>;
      const name = typeof seed.name === "string" ? seed.name.trim() : "";
      if (!name) return null;
      return [name, seed.website ?? "", seed.note ?? ""].join(" | ").replace(/\s+\|\s+$/g, "");
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function parseCompetitorSeeds(value: string): CompetitorSeed[] {
  const seeds: CompetitorSeed[] = [];
  const seen = new Set<string>();
  for (const line of value.split("\n")) {
    const [nameRaw, websiteRaw, noteRaw] = line.split("|").map((part) => part?.replace(/\s+/g, " ").trim() ?? "");
    if (!nameRaw) continue;
    const key = nameRaw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({
      name: nameRaw.slice(0, 160),
      website: websiteRaw ? websiteRaw.slice(0, 240) : null,
      note: noteRaw ? noteRaw.slice(0, 1500) : null,
    });
    if (seeds.length >= 25) break;
  }
  return seeds;
}

export function CompaniesTab() {
  const locale = useLocale();
  const copy = getCompaniesTabCopy(locale);
  const { toast } = useToast();
  const selectedCompanySettingsRef = useRef<HTMLDivElement | null>(null);
  const accessSettingsRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToSelectedRef = useRef<"profile" | "access" | null>(null);
  const membersFetchSeqRef = useRef(0);
  const domainGrantFetchSeqRef = useRef(0);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyDescription, setNewCompanyDescription] = useState("");
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [domainGrantMembers, setDomainGrantMembers] = useState<DomainGrantMember[]>([]);
  const [domainGrantDrafts, setDomainGrantDrafts] = useState<Record<string, Record<string, DomainDraftValue>>>({});
  const [isLoadingDomainGrants, setIsLoadingDomainGrants] = useState(false);
  const [savingDomainGrantUserId, setSavingDomainGrantUserId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [isSwitchingActive, setIsSwitchingActive] = useState(false);
  const [companyDraftName, setCompanyDraftName] = useState("");
  const [companyDraftDescription, setCompanyDraftDescription] = useState("");
  const [companyDraftWebsite, setCompanyDraftWebsite] = useState("");
  const [companyDraftBusinessType, setCompanyDraftBusinessType] = useState("");
  const [companyDraftJurisdiction, setCompanyDraftJurisdiction] = useState("");
  const [companyDraftEntityType, setCompanyDraftEntityType] = useState("");
  const [companyDraftParentId, setCompanyDraftParentId] = useState<string | null>(null);
  const [companyDraftAliases, setCompanyDraftAliases] = useState<string[]>([]);
  const [companyDraftReportingCurrency, setCompanyDraftReportingCurrency] = useState<string>("USD");
  const [companyDraftMarketResearchSummary, setCompanyDraftMarketResearchSummary] = useState("");
  const [companyDraftTargetMarkets, setCompanyDraftTargetMarkets] = useState("");
  const [companyDraftCustomerSegments, setCompanyDraftCustomerSegments] = useState("");
  const [companyDraftProductLines, setCompanyDraftProductLines] = useState("");
  const [companyDraftCompetitorSeeds, setCompanyDraftCompetitorSeeds] = useState("");
  const [companyDraftMarketContextNotes, setCompanyDraftMarketContextNotes] = useState("");
  const [aliasInput, setAliasInput] = useState("");
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [isLoadingCompanyDetail, setIsLoadingCompanyDetail] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isDeletingCompany, setIsDeletingCompany] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [appOrigin, setAppOrigin] = useState(
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "",
  );
  const [copiedMcpLink, setCopiedMcpLink] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedCompany = selectedProject?.projectKind === "company" ? selectedProject : null;
  const selectedCompanyId = selectedCompany?.id ?? null;
  const allCompaniesMcpLink = appOrigin ? `${appOrigin}/api/chatgpt/mcp-v3` : "";
  const selectedCompanyMcpLink =
    selectedCompany?.slug && appOrigin
      ? `${appOrigin}/api/chatgpt/mcp-v3/${selectedCompany.slug}`
      : "";

  const canManageMembers = selectedCompany ? MANAGER_ROLES.has(selectedCompany.role) : false;
  const canAssignOwner = selectedCompany?.role === "owner";
  const canManageDomainGrants =
    Boolean(selectedCompany) &&
    selectedCompany?.id === activeProjectId &&
    canManageMembers;
  const domainGrantMemberByUserId = useMemo(
    () => new Map(domainGrantMembers.map((member) => [member.userId, member])),
    [domainGrantMembers],
  );

  const scrollToSettingsSection = useCallback((section: "profile" | "access") => {
    window.requestAnimationFrame(() => {
      const node = section === "access" ? accessSettingsRef.current : selectedCompanySettingsRef.current;
      node?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const selectProjectForSettings = useCallback(
    (projectId: string, section: "profile" | "access") => {
      if (projectId === selectedProjectId) {
        scrollToSettingsSection(section);
        return;
      }
      shouldScrollToSelectedRef.current = section;
      setSelectedProjectId(projectId);
    },
    [scrollToSettingsSection, selectedProjectId],
  );

  useEffect(() => {
    if (!selectedCompany) {
      setCompanyDraftName("");
      setCompanyDraftDescription("");
      setCompanyDraftWebsite("");
      setCompanyDraftBusinessType("");
      setCompanyDraftJurisdiction("");
      setCompanyDraftEntityType("");
      setCompanyDraftParentId(null);
      setCompanyDraftAliases([]);
      setCompanyDraftReportingCurrency("USD");
      setCompanyDraftMarketResearchSummary("");
      setCompanyDraftTargetMarkets("");
      setCompanyDraftCustomerSegments("");
      setCompanyDraftProductLines("");
      setCompanyDraftCompetitorSeeds("");
      setCompanyDraftMarketContextNotes("");
      setAliasInput("");
      setDeleteConfirmName("");
      return;
    }
    setCompanyDraftName(selectedCompany.name);
    setCompanyDraftDescription(selectedCompany.companyDescription ?? "");
    setAliasInput("");
    setDeleteConfirmName("");
  }, [selectedCompany]);

  useEffect(() => {
    const target = shouldScrollToSelectedRef.current;
    if (!target) return;
    shouldScrollToSelectedRef.current = null;
    scrollToSettingsSection(target);
  }, [scrollToSettingsSection, selectedProjectId]);

  // Full editable company profile lives on the per-company detail endpoint, not on /api/projects.
  // Fetch it when the selected company changes so the form starts pre-populated.
  useEffect(() => {
    if (!selectedCompany?.id) return;
    let cancelled = false;
    setIsLoadingCompanyDetail(true);
    fetch(`/api/companies/${selectedCompany.id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("detail fetch failed"))))
      .then((data) => {
        if (cancelled) return;
        const c = data?.company as
          | {
              parentCompanyId?: string | null;
              jurisdiction?: string | null;
              entityType?: string | null;
              businessType?: string | null;
              website?: string | null;
              aliases?: string[];
              reportingCurrency?: string | null;
              businessProfileAdditions?: BusinessProfileAdditionsDraft;
            }
          | undefined;
        setCompanyDraftParentId(c?.parentCompanyId ?? null);
        setCompanyDraftJurisdiction(c?.jurisdiction ?? "");
        setCompanyDraftEntityType(c?.entityType ?? "");
        setCompanyDraftBusinessType(c?.businessType ?? "");
        setCompanyDraftWebsite(c?.website ?? "");
        setCompanyDraftAliases(Array.isArray(c?.aliases) ? c!.aliases : []);
        setCompanyDraftReportingCurrency(
          typeof c?.reportingCurrency === "string" && c.reportingCurrency
            ? c.reportingCurrency
            : "USD",
        );
        const additions = c?.businessProfileAdditions ?? {};
        setCompanyDraftMarketResearchSummary(additions.marketResearchSummary ?? "");
        setCompanyDraftTargetMarkets(joinDraftList(additions.targetMarkets));
        setCompanyDraftCustomerSegments(joinDraftList(additions.customerSegments));
        setCompanyDraftProductLines(joinDraftList(additions.productLines));
        setCompanyDraftCompetitorSeeds(serializeCompetitorSeeds(additions.competitorSeeds));
        setCompanyDraftMarketContextNotes(additions.notes ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setCompanyDraftParentId(null);
        setCompanyDraftJurisdiction("");
        setCompanyDraftEntityType("");
        setCompanyDraftBusinessType("");
        setCompanyDraftWebsite("");
        setCompanyDraftAliases([]);
        setCompanyDraftReportingCurrency("USD");
        setCompanyDraftMarketResearchSummary("");
        setCompanyDraftTargetMarkets("");
        setCompanyDraftCustomerSegments("");
        setCompanyDraftProductLines("");
        setCompanyDraftCompetitorSeeds("");
        setCompanyDraftMarketContextNotes("");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingCompanyDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompany?.id]);

  const fetchProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load projects");
      }
      const data = (await res.json()) as ProjectsResponse;
      setProjects(data.projects ?? []);
      setActiveProjectId(data.activeProjectId ?? null);
      setSelectedProjectId((current) => {
        if (current && (data.projects ?? []).some((c) => c.id === current)) {
          return current;
        }
        return data.activeProjectId ?? data.projects?.[0]?.id ?? null;
      });
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
      return null;
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const fetchMembers = useCallback(async (companyId: string) => {
    const requestSeq = membersFetchSeqRef.current + 1;
    membersFetchSeqRef.current = requestSeq;
    setIsLoadingMembers(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/members`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load company members");
      }
      const data = await res.json();
      if (membersFetchSeqRef.current !== requestSeq) return;
      setMembers((data.members ?? []) as Member[]);
    } catch (err) {
      if (membersFetchSeqRef.current !== requestSeq) return;
      setError(err instanceof Error ? err.message : "Failed to load company members");
      setMembers([]);
    } finally {
      if (membersFetchSeqRef.current === requestSeq) {
        setIsLoadingMembers(false);
      }
    }
  }, []);

  const fetchDomainGrants = useCallback(async () => {
    const requestSeq = domainGrantFetchSeqRef.current + 1;
    domainGrantFetchSeqRef.current = requestSeq;
    const requestedCompanyId = selectedCompanyId;

    if (!requestedCompanyId || !canManageDomainGrants) {
      setDomainGrantMembers([]);
      setDomainGrantDrafts({});
      setIsLoadingDomainGrants(false);
      return;
    }

    setIsLoadingDomainGrants(true);
    try {
      const res = await fetch("/api/admin/company-domain-grants", {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load domain grants");
      }
      const data = await res.json();
      if (domainGrantFetchSeqRef.current !== requestSeq) return;
      if (data.companyId && data.companyId !== requestedCompanyId) {
        throw new Error("Loaded grants for a different company");
      }
      const nextMembers = (data.members ?? []) as DomainGrantMember[];
      setDomainGrantMembers(nextMembers);
      setDomainGrantDrafts(
        Object.fromEntries(
          nextMembers.map((member) => [member.userId, draftFromGrants(member.grants ?? [])]),
        ),
      );
    } catch (err) {
      if (domainGrantFetchSeqRef.current !== requestSeq) return;
      setError(err instanceof Error ? err.message : "Failed to load domain grants");
      setDomainGrantMembers([]);
      setDomainGrantDrafts({});
    } finally {
      if (domainGrantFetchSeqRef.current === requestSeq) {
        setIsLoadingDomainGrants(false);
      }
    }
  }, [canManageDomainGrants, selectedCompanyId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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
    if (typeof window === "undefined") return;
    setAppOrigin(window.location.origin.replace(/\/$/, ""));
  }, []);

  useEffect(() => {
    if (!selectedCompany?.id) {
      membersFetchSeqRef.current += 1;
      setMembers([]);
      setIsLoadingMembers(false);
      return;
    }
    fetchMembers(selectedCompany.id);
  }, [fetchMembers, selectedCompany?.id]);

  useEffect(() => {
    void fetchDomainGrants();
  }, [fetchDomainGrants]);

  const handleCreateCompany = async () => {
    if (!newCompanyName.trim()) return;
    setIsCreatingCompany(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCompanyName.trim(),
          companyDescription: newCompanyDescription.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create company");
      }
      const data = await res.json();
      const createdCompany = data.company as Project;
      setNewCompanyName("");
      setNewCompanyDescription("");
      await fetchProjects();
      setActiveProjectId(createdCompany.id);
      setSelectedProjectId(createdCompany.id);
      window.dispatchEvent(
        new CustomEvent<CompaniesChangedDetail>(COMPANIES_CHANGED_EVENT, {
          detail: {
            activeCompanyId: createdCompany.id,
            company: {
              id: createdCompany.id,
              name: createdCompany.name,
              role: createdCompany.role ?? "owner",
            },
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent<ProjectsChangedDetail>(PROJECTS_CHANGED_EVENT, {
          detail: {
            activeProjectId: createdCompany.id,
            project: {
              id: createdCompany.id,
              name: createdCompany.name,
              role: createdCompany.role ?? "owner",
              projectKind: "company",
            },
          },
        }),
      );
      toast(`Created company "${createdCompany.name}" and switched to it.`, {
        variant: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setIsCreatingCompany(false);
    }
  };

  const handleSaveCompany = async () => {
    if (!selectedCompany?.id || !companyDraftName.trim()) return;
    setIsSavingCompany(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${selectedCompany.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: companyDraftName.trim(),
          companyDescription: companyDraftDescription.trim(),
          website: companyDraftWebsite.trim() || null,
          businessType: companyDraftBusinessType.trim() || null,
          jurisdiction: companyDraftJurisdiction.trim() || null,
          entityType: companyDraftEntityType.trim() || null,
          parentCompanyId: companyDraftParentId,
          aliases: companyDraftAliases,
          reportingCurrency: companyDraftReportingCurrency,
          businessProfileAdditions: {
            marketResearchSummary: companyDraftMarketResearchSummary.trim() || null,
            targetMarkets: splitDraftList(companyDraftTargetMarkets),
            customerSegments: splitDraftList(companyDraftCustomerSegments),
            productLines: splitDraftList(companyDraftProductLines),
            competitorSeeds: parseCompetitorSeeds(companyDraftCompetitorSeeds),
            notes: companyDraftMarketContextNotes.trim() || null,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update company");
      }
      const data = await res.json();
      const updatedCompany = data.company as Project;
      setProjects((current) =>
        current.map((project) =>
          project.id === updatedCompany.id
            ? { ...project, ...updatedCompany }
            : project,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update company");
    } finally {
      setIsSavingCompany(false);
    }
  };

  const parentOptions = useMemo(
    () =>
      projects
        .filter(
          (project) =>
            project.projectKind === "company" && project.id !== selectedCompany?.id,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects, selectedCompany?.id],
  );

  const handleAddAlias = useCallback(() => {
    const trimmed = aliasInput.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    if (trimmed.length > 80) {
      setError("Each alias must be 80 characters or fewer");
      return;
    }
    setCompanyDraftAliases((current) => {
      const lower = trimmed.toLowerCase();
      if (current.some((existing) => existing.toLowerCase() === lower)) return current;
      if (current.length >= 32) {
        setError("A company can have at most 32 aliases");
        return current;
      }
      return [...current, trimmed];
    });
    setAliasInput("");
  }, [aliasInput]);

  const handleRemoveAlias = useCallback((alias: string) => {
    setCompanyDraftAliases((current) => current.filter((a) => a !== alias));
  }, []);

  const canDeleteCompany = Boolean(
    selectedCompany && (selectedCompany.role === "owner" || isPlatformAdmin),
  );

  const handleDeleteCompany = async () => {
    if (!selectedCompany?.id) return;
    setIsDeletingCompany(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${selectedCompany.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmName: deleteConfirmName.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete company");
      }
      const data = await res.json();
      const nextActiveCompanyId =
        typeof data.nextActiveCompanyId === "string" ? data.nextActiveCompanyId : null;
      const refreshed = await fetchProjects();
      const nextCompany =
        refreshed?.projects?.find((project) => project.id === nextActiveCompanyId && project.projectKind === "company") ?? null;
      window.dispatchEvent(
        new CustomEvent<CompaniesChangedDetail>(COMPANIES_CHANGED_EVENT, {
          detail: {
            activeCompanyId: nextActiveCompanyId,
            company: nextCompany
              ? {
                  id: nextCompany.id,
                  name: nextCompany.name,
                  role: nextCompany.role,
                }
              : null,
          },
        }),
      );
      toast(`Deleted company "${selectedCompany.name}".`, {
        variant: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete company");
    } finally {
      setIsDeletingCompany(false);
    }
  };

  const handleSetActiveProject = async (project: Project) => {
    setIsSwitchingActive(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to switch active project");
      }
      setActiveProjectId(project.id);
      window.dispatchEvent(
        new CustomEvent<ProjectsChangedDetail>(PROJECTS_CHANGED_EVENT, {
          detail: {
            activeProjectId: project.id,
            project: {
              id: project.id,
              name: project.name,
              role: project.role,
              projectKind: project.projectKind,
            },
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch active project");
    } finally {
      setIsSwitchingActive(false);
    }
  };

  const handleInvite = async () => {
    if (!selectedCompany?.id || !inviteEmail.trim()) return;
    setIsInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${selectedCompany.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to grant access");
      }
      setInviteEmail("");
      setInviteRole("member");
      await fetchMembers(selectedCompany.id);
      await fetchDomainGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant access");
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveMember = async (member: Member) => {
    if (!selectedCompany?.id) return;
    setRemovingUserId(member.userId);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${selectedCompany.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove member");
      }
      await fetchMembers(selectedCompany.id);
      await fetchDomainGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingUserId(null);
    }
  };

  const handleCopyMcpLink = useCallback(
    async (key: string, text: string, label: string) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedMcpLink(key);
        toast(`Copied ${label}.`, { variant: "success" });
        window.setTimeout(() => {
          setCopiedMcpLink((current) => (current === key ? null : current));
        }, 2000);
      } catch {
        setError(`Failed to copy ${label}`);
      }
    },
    [toast],
  );

  const updateDomainGrantDraft = useCallback(
    (userId: string, domain: string, accessLevel: DomainDraftValue) => {
      setDomainGrantDrafts((current) => {
        const nextUserDraft = {
          ...draftFromGrants(domainGrantMemberByUserId.get(userId)?.grants ?? []),
          ...(current[userId] ?? {}),
        };

        if (domain === "*" && accessLevel !== "none") {
          for (const option of COMPANY_DOMAIN_OPTIONS) {
            nextUserDraft[option.domain] = option.domain === "*" ? accessLevel : "none";
          }
        } else {
          nextUserDraft[domain] = accessLevel;
          if (domain !== "*" && accessLevel !== "none") {
            nextUserDraft["*"] = "none";
          }
        }

        return {
          ...current,
          [userId]: nextUserDraft,
        };
      });
    },
    [domainGrantMemberByUserId],
  );

  const saveDomainGrantDraft = useCallback(
    async (member: Member) => {
      const draft =
        domainGrantDrafts[member.userId] ??
        draftFromGrants(domainGrantMemberByUserId.get(member.userId)?.grants ?? []);
      const grants = Object.entries(draft)
        .filter(([, accessLevel]) => accessLevel !== "none")
        .map(([domain, accessLevel]) => ({
          domain,
          accessLevel: accessLevel as DomainAccessLevel,
        }));

      setSavingDomainGrantUserId(member.userId);
      setError(null);
      try {
        const res = await fetch("/api/admin/company-domain-grants", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: member.userId,
            reason: "Updated from company settings UI",
            source: "settings_ui",
            grants,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to save domain grants");
        }
        await fetchDomainGrants();
        toast(`Updated domain access for ${member.email}.`, { variant: "success" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save domain grants");
      } finally {
        setSavingDomainGrantUserId(null);
      }
    },
    [domainGrantDrafts, domainGrantMemberByUserId, fetchDomainGrants, toast],
  );

  return (
    <div className="space-y-4 mt-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4" />
            {copy.companiesTitle}
          </CardTitle>
          <CardDescription>
            {copy.companiesDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="company-name">{copy.newCompany}</Label>
              <Input
                id="company-name"
                placeholder="e.g. Example Holdings"
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="company-description">{copy.agentDescription}</Label>
              <textarea
                id="company-description"
                rows={3}
                className="min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="What this company does, why it exists, key scope, context for agents."
                value={newCompanyDescription}
                onChange={(e) => setNewCompanyDescription(e.target.value)}
                maxLength={4000}
              />
            </div>
            <Button
              onClick={handleCreateCompany}
              disabled={!newCompanyName.trim() || isCreatingCompany}
            >
              {isCreatingCompany ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {copy.create}
            </Button>
          </div>

          {isLoadingProjects ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {copy.loadingCompanies}
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.emptyCompanies}</p>
          ) : (
            <>
            <div className="space-y-2 md:hidden">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-md border border-border bg-card/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{project.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{projectKindLabel(project.projectKind, copy)}</Badge>
                        <Badge variant="outline">{project.role}</Badge>
                        {activeProjectId === project.id ? <Badge>{copy.active}</Badge> : null}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {project.slug ? `slug: ${project.slug}` : "slug pending"}
                      </div>
                    </div>
                    {project.projectKind === "personal" ? (
                      <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectProjectForSettings(project.id, "profile")}
                    >
                      {copy.profile}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectProjectForSettings(project.id, "access")}
                    >
                      {copy.access}
                    </Button>
                    <Button
                      size="sm"
                      variant={activeProjectId === project.id ? "secondary" : "default"}
                      onClick={() => handleSetActiveProject(project)}
                      disabled={isSwitchingActive || activeProjectId === project.id}
                      className="col-span-2"
                    >
                      {activeProjectId === project.id ? copy.active : copy.makeActive}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden rounded-md border border-border overflow-hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">{copy.tableCompany}</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">{copy.tableType}</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">{copy.tableRole}</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">{copy.tableStatus}</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">{copy.tableActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{project.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {project.slug ? `slug: ${project.slug}` : "slug pending"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{projectKindLabel(project.projectKind, copy)}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{project.role}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {activeProjectId === project.id ? (
                          <Badge>{copy.active}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">{copy.inactive}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => selectProjectForSettings(project.id, "profile")}
                          >
                            {copy.profile}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => selectProjectForSettings(project.id, "access")}
                          >
                            {copy.access}
                          </Button>
                          <Button
                            size="sm"
                            variant={activeProjectId === project.id ? "secondary" : "default"}
                            onClick={() => handleSetActiveProject(project)}
                            disabled={isSwitchingActive || activeProjectId === project.id}
                          >
                            {activeProjectId === project.id ? copy.active : copy.makeActive}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card ref={selectedCompanySettingsRef}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4" />
            {copy.companyProfile}
          </CardTitle>
          <CardDescription>
            {selectedCompany
              ? copy.companyContext(selectedCompany.name)
              : selectedProject
                ? copy.personalProfileManagedSeparately
                : copy.selectCompanyFirst}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedProject ? (
            <p className="text-sm text-muted-foreground">{copy.companyNotSelected}</p>
          ) : selectedProject.projectKind === "personal" ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {copy.personalAutoManaged}
            </div>
          ) : !canManageMembers ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
              <Shield className="size-4" />
              {copy.needOwnerAdminProfile}
            </div>
          ) : (
            <>
              <div className="grid gap-4">
                <div className="space-y-1">
                  <Label htmlFor="selected-company-name">{copy.companyName}</Label>
                  <Input
                    id="selected-company-name"
                    value={companyDraftName}
                    onChange={(e) => setCompanyDraftName(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="selected-company-website">{copy.website}</Label>
                    <Input
                      id="selected-company-website"
                      value={companyDraftWebsite}
                      onChange={(e) => setCompanyDraftWebsite(e.target.value)}
                      placeholder="https://example.com"
                      maxLength={240}
                      disabled={isLoadingCompanyDetail}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="selected-company-business-type">{copy.businessType}</Label>
                    <Input
                      id="selected-company-business-type"
                      value={companyDraftBusinessType}
                      onChange={(e) => setCompanyDraftBusinessType(e.target.value)}
                      placeholder="Hospitality"
                      maxLength={120}
                      disabled={isLoadingCompanyDetail}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="selected-company-jurisdiction">{copy.jurisdiction}</Label>
                    <Input
                      id="selected-company-jurisdiction"
                      value={companyDraftJurisdiction}
                      onChange={(e) => setCompanyDraftJurisdiction(e.target.value)}
                      placeholder="ID"
                      maxLength={80}
                      disabled={isLoadingCompanyDetail}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="selected-company-entity-type">{copy.entityType}</Label>
                    <Input
                      id="selected-company-entity-type"
                      value={companyDraftEntityType}
                      onChange={(e) => setCompanyDraftEntityType(e.target.value)}
                      placeholder="PT"
                      maxLength={80}
                      disabled={isLoadingCompanyDetail}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="selected-company-description">{copy.agentDescription}</Label>
                  <textarea
                    id="selected-company-description"
                    rows={6}
                    className="min-h-[140px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    placeholder="Explain what this company does, its mission, major business lines, entities, and the context agents should keep in mind."
                    value={companyDraftDescription}
                    onChange={(e) => setCompanyDraftDescription(e.target.value)}
                    maxLength={4000}
                  />
                  <p className="text-xs text-muted-foreground">
                    {copy.contextHint}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="selected-company-reporting-currency">{copy.reportingCurrency}</Label>
                  <Input
                    id="selected-company-reporting-currency"
                    value={companyDraftReportingCurrency}
                    onChange={(e) =>
                      setCompanyDraftReportingCurrency(
                        e.target.value.toUpperCase().slice(0, 5),
                      )
                    }
                    placeholder="USD"
                    maxLength={5}
                    disabled={isLoadingCompanyDetail}
                  />
                  <p className="text-xs text-muted-foreground">
                    {copy.currencyHint}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="selected-company-parent">{copy.parentCompany}</Label>
                  <Select
                    value={companyDraftParentId ?? "__none__"}
                    onValueChange={(value) =>
                      setCompanyDraftParentId(value === "__none__" ? null : value)
                    }
                    disabled={isLoadingCompanyDetail}
                  >
                    <SelectTrigger id="selected-company-parent" className="w-full">
                      <SelectValue placeholder={copy.noParent} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{copy.noParent}</SelectItem>
                      {parentOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {copy.parentHint}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="selected-company-alias-input">{copy.aliases}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="selected-company-alias-input"
                      placeholder="e.g. PartnerA, Northstar"
                      value={aliasInput}
                      onChange={(e) => setAliasInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          handleAddAlias();
                        }
                      }}
                      maxLength={80}
                      disabled={isLoadingCompanyDetail}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddAlias}
                      disabled={!aliasInput.trim() || isLoadingCompanyDetail}
                    >
                      <Plus className="size-4" />
                      {copy.add}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {companyDraftAliases.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {copy.aliasesEmpty}
                      </p>
                    ) : (
                      companyDraftAliases.map((alias) => (
                        <Badge
                          key={alias}
                          variant="secondary"
                          className="gap-1 pl-2 pr-1 py-0.5"
                        >
                          {alias}
                          <button
                            type="button"
                            onClick={() => handleRemoveAlias(alias)}
                            aria-label={`Remove alias ${alias}`}
                            className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
                  <div className="text-sm font-medium">{copy.manualMarketContext}</div>
                  <div className="space-y-1">
                    <Label htmlFor="selected-company-market-summary">{copy.marketResearchSummary}</Label>
                    <textarea
                      id="selected-company-market-summary"
                      rows={4}
                      className="min-h-[96px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      value={companyDraftMarketResearchSummary}
                      onChange={(e) => setCompanyDraftMarketResearchSummary(e.target.value)}
                      maxLength={6000}
                      disabled={isLoadingCompanyDetail}
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="selected-company-target-markets">{copy.targetMarkets}</Label>
                      <Input
                        id="selected-company-target-markets"
                        value={companyDraftTargetMarkets}
                        onChange={(e) => setCompanyDraftTargetMarkets(e.target.value)}
                        placeholder="Bali, Indonesia"
                        disabled={isLoadingCompanyDetail}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="selected-company-customer-segments">{copy.customerSegments}</Label>
                      <Input
                        id="selected-company-customer-segments"
                        value={companyDraftCustomerSegments}
                        onChange={(e) => setCompanyDraftCustomerSegments(e.target.value)}
                        placeholder="Visitors, residents"
                        disabled={isLoadingCompanyDetail}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="selected-company-product-lines">{copy.productLines}</Label>
                      <Input
                        id="selected-company-product-lines"
                        value={companyDraftProductLines}
                        onChange={(e) => setCompanyDraftProductLines(e.target.value)}
                        placeholder="F&B, events"
                        disabled={isLoadingCompanyDetail}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="selected-company-competitor-seeds">{copy.competitorSeeds}</Label>
                      <textarea
                        id="selected-company-competitor-seeds"
                        rows={4}
                        className="min-h-[96px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        placeholder="Name | https://example.com | note"
                        value={companyDraftCompetitorSeeds}
                        onChange={(e) => setCompanyDraftCompetitorSeeds(e.target.value)}
                        disabled={isLoadingCompanyDetail}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="selected-company-market-notes">{copy.marketContextNotes}</Label>
                      <textarea
                        id="selected-company-market-notes"
                        rows={4}
                        className="min-h-[96px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        value={companyDraftMarketContextNotes}
                        onChange={(e) => setCompanyDraftMarketContextNotes(e.target.value)}
                        maxLength={1000}
                        disabled={isLoadingCompanyDetail}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleSaveCompany}
                  disabled={!companyDraftName.trim() || isSavingCompany}
                >
                  {isSavingCompany ? <Loader2 className="size-4 animate-spin" /> : null}
                  {copy.saveProfile}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4" />
            ChatGPT App Links
          </CardTitle>
          <CardDescription>
            Copy the current ChatGPT MCP app URL for this company or the all-companies route.
            Use these `mcp-v3` links for new ChatGPT app connections.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="all-companies-mcp-link">All accessible companies</Label>
            <div className="flex gap-2">
              <Input
                id="all-companies-mcp-link"
                value={allCompaniesMcpLink}
                readOnly
                placeholder="Public app URL is not configured yet"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void handleCopyMcpLink(
                    "all-companies",
                    allCompaniesMcpLink,
                    "all-companies ChatGPT link",
                  )
                }
                disabled={!allCompaniesMcpLink}
              >
                <Copy className="size-4" />
                {copiedMcpLink === "all-companies" ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This route exposes every company the signed-in user can access. Tools must pass
              `company_id` when the company context is ambiguous.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="selected-company-mcp-link">Selected company only</Label>
            <div className="flex gap-2">
              <Input
                id="selected-company-mcp-link"
                value={selectedCompanyMcpLink}
                readOnly
                placeholder={
                  selectedCompany
                    ? "This company still has no public slug"
                    : copy.selectedCompanyLinkPlaceholder
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void handleCopyMcpLink(
                    "selected-company",
                    selectedCompanyMcpLink,
                    "company ChatGPT link",
                  )
                }
                disabled={!selectedCompanyMcpLink}
              >
                <Copy className="size-4" />
                {copiedMcpLink === "selected-company" ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedCompany
                ? copy.selectedCompanyLinkHint
                : copy.selectedCompanyLinkEmpty}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card ref={accessSettingsRef}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" />
            {copy.companyAccessTitle}
          </CardTitle>
          <CardDescription>
            {selectedCompany
              ? copy.companyAccessDescription(selectedCompany.name)
              : selectedProject
                ? copy.personalNotShared
                : copy.selectCompanyFirst}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedProject ? (
            <p className="text-sm text-muted-foreground">{copy.companyNotSelected}</p>
          ) : selectedProject.projectKind === "personal" ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {copy.personalOwnerOnly}
            </div>
          ) : !canManageMembers ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
              <Shield className="size-4" />
              {copy.needOwnerAdminAccess}
            </div>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-[1fr_220px_auto] md:items-end">
                <div className="space-y-1">
                  <Label htmlFor="invite-email">{copy.userEmail}</Label>
                  <Input
                    id="invite-email"
                    placeholder="user@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="invite-role">{copy.role}</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.filter((role) => canAssignOwner || role !== "owner").map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleInvite} disabled={!inviteEmail.trim() || isInviting}>
                  {isInviting ? <Loader2 className="size-4 animate-spin" /> : null}
                  {copy.addAccess}
                </Button>
              </div>

              <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <SlidersHorizontal className="size-4" />
                  {copy.informationDomains}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {COMPANY_DOMAIN_OPTIONS.map((option) => (
                    <Badge key={option.domain} variant="secondary" className="font-normal">
                      {domainLabel(option.domain, option.label, copy)}
                    </Badge>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {copy.accessLevels}
                </div>
              </div>

              {isLoadingMembers ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {copy.loadingUsers}
                </div>
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.noUsers}</p>
              ) : (
                <div className="space-y-3">
                  {members.map((member) => {
                    const grantMember = domainGrantMemberByUserId.get(member.userId);
                    const draft =
                      domainGrantDrafts[member.userId] ??
                      draftFromGrants(grantMember?.grants ?? []);
                    const roleFull = member.role === "owner" || member.role === "admin";
                    const wildcardActive = draft["*"] !== "none";

                    return (
                      <div
                        key={member.userId}
                        className="rounded-lg border border-border bg-card/50 p-3"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-sm font-medium">{member.name}</div>
                              <Badge variant="outline">{member.role}</Badge>
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                            <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                              <SlidersHorizontal className="mt-0.5 size-3.5 shrink-0" />
                              <span>{domainGrantSummary(grantMember, member.role, copy)}</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveMember(member)}
                            disabled={removingUserId === member.userId}
                            className="self-start"
                          >
                            {removingUserId === member.userId ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              copy.remove
                            )}
                          </Button>
                        </div>

                        <div className="mt-3 rounded-md border border-border/70 bg-background/40 p-3">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="text-sm font-medium">{copy.domainAccessTitle}</div>
                              <div className="text-xs text-muted-foreground">
                                {copy.domainAccessDescription}
                              </div>
                            </div>
                            {selectedCompany?.id !== activeProjectId && selectedCompany ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSetActiveProject(selectedCompany)}
                              >
                                {copy.makeActive}
                              </Button>
                            ) : null}
                          </div>

                          {roleFull ? (
                            <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                              {copy.roleFullAccess}
                            </div>
                          ) : selectedCompany?.id !== activeProjectId ? (
                            <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                              {copy.activeCompanyRequired}
                            </div>
                          ) : isLoadingDomainGrants ? (
                            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="size-4 animate-spin" />
                              {copy.loadingDomainGrants}
                            </div>
                          ) : (
                            <>
                              <div className="mt-3 grid gap-2 md:grid-cols-2">
                                {COMPANY_DOMAIN_OPTIONS.map((option) => (
                                  <div
                                    key={option.domain}
                                    className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm">
                                        {domainLabel(option.domain, option.label, copy)}
                                      </div>
                                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                                        {option.domain}
                                      </div>
                                    </div>
                                    <Select
                                      value={draft[option.domain] ?? "none"}
                                      onValueChange={(value) =>
                                        updateDomainGrantDraft(
                                          member.userId,
                                          option.domain,
                                          value as DomainDraftValue,
                                        )
                                      }
                                      disabled={wildcardActive && option.domain !== "*"}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {DOMAIN_ACCESS_OPTIONS.map((accessOption) => (
                                          <SelectItem
                                            key={accessOption.value}
                                            value={accessOption.value}
                                          >
                                            {accessLevelLabel(accessOption.value, copy)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => void saveDomainGrantDraft(member)}
                                  disabled={savingDomainGrantUserId === member.userId}
                                >
                                  {savingDomainGrantUserId === member.userId ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : null}
                                  {copy.saveDomains}
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-4" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            {selectedCompany
              ? `Delete ${selectedCompany.name} and all of its documents, connectors, chats, staging rows, and company repo data.`
              : selectedProject
                ? copy.personalDeleteDisabled
                : copy.selectCompanyFirst}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedProject ? (
            <p className="text-sm text-muted-foreground">{copy.companyNotSelected}</p>
          ) : selectedProject.projectKind === "personal" ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {copy.personalDeleteLifecycleDisabled}
            </div>
          ) : !canDeleteCompany ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
              <Shield className="size-4" />
              Only the company owner or a platform admin can delete this company.
            </div>
          ) : (
            <>
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
                This action cannot be undone. If the deleted company is currently active, Corpus will switch to your next available company automatically.
              </div>
              <div className="space-y-1">
                <Label htmlFor="delete-company-confirm">
                  Type <span className="font-medium">{selectedCompany!.name}</span> to confirm
                </Label>
                <Input
                  id="delete-company-confirm"
                  value={deleteConfirmName}
                  onChange={(event) => setDeleteConfirmName(event.target.value)}
                  placeholder={selectedCompany!.name}
                  autoComplete="off"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  onClick={handleDeleteCompany}
                  disabled={
                    isDeletingCompany || deleteConfirmName.trim() !== selectedCompany!.name
                  }
                >
                  {isDeletingCompany ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete company
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
