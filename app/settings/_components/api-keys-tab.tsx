"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Key,
  Copy,
  Check,
  Trash2,
  Plus,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  API_KEY_SCOPE_LABELS,
  API_KEY_SUPER_SCOPE,
  CONNECTOR_OPERATOR_API_KEY_SCOPES,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";
import {
  API_KEY_COMPANY_SCOPE_MODE_LABELS,
  type ApiKeyCompanyScopeMode,
} from "@/lib/api-key-company-scope";
import {
  API_KEY_ACCESS_POLICY_VERSION_LABELS,
  type ApiKeyAccessPolicyVersion,
} from "@/lib/api-key-access-policy";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isRevoked: boolean;
  scopes: ApiKeyScope[];
  companyScopeMode: ApiKeyCompanyScopeMode;
  accessPolicyVersion: ApiKeyAccessPolicyVersion;
  defaultCompanyId: string | null;
  allowedCompanyIds: string[];
  canRevealSecret?: boolean;
}

interface CompanyOption {
  id: string;
  name: string;
  slug: string | null;
  role: string;
}

interface AccessInfo {
  baseUrl: string;
  companyId: string | null;
  companySlug: string | null;
  companyScopeMode: ApiKeyCompanyScopeMode;
  accessPolicyVersion: ApiKeyAccessPolicyVersion;
  allowedCompanyIds: string[];
  endpoints: {
    agentSession: string;
    agentCompanies: string;
    agentCompanyMembers: string;
    agentProfile: string;
    agentSettings: string;
    agentDashboard: string;
    agentPeople: string;
    agentConnectors: string;
    agentMcp: string;
    agentWorkflowResolve?: string;
    query: string;
    search: string;
    entity: string;
    file: string;
    mcp: string;
    connectorsHub: string;
    connectorsHubLegacy?: string;
    documents?: string;
    documentsUpload?: string;
    documentsBatchUpload?: string;
    documentQuestions?: string;
    documentQuestionsTemplate?: string;
    routines?: string;
    routineTemplates?: string;
    routineDetailTemplate?: string;
    routineManifestTemplate?: string;
    routineRunTemplate?: string;
    routineSourcesTemplate?: string;
    routineSourceTemplate?: string;
    routineSourceTestTemplate?: string;
    routineCandidatesTemplate?: string;
    routineCandidateTemplate?: string;
  };
}

interface CreatedKeyPayload {
  key: string;
  access: AccessInfo | null;
  scopes: ApiKeyScope[];
  companyScopeMode: ApiKeyCompanyScopeMode;
  accessPolicyVersion: ApiKeyAccessPolicyVersion;
  allowedCompanyIds: string[];
}

interface ExistingKeyDetail extends ApiKey {
  access: AccessInfo;
}

interface ScopePreset {
  id: string;
  label: string;
  description: string;
  scopes: ApiKeyScope[];
  suggestedName: string;
}

interface ClientSetupSnippet {
  id: string;
  label: string;
  description: string;
  snippet: string;
  note?: string;
}

const API_KEY_SCOPE_OPTIONS = Object.entries(API_KEY_SCOPE_LABELS) as Array<
  [ApiKeyScope, string]
>;
const SELECTABLE_API_KEY_SCOPE_OPTIONS = API_KEY_SCOPE_OPTIONS.filter(
  ([scope]) => scope !== API_KEY_SUPER_SCOPE,
);
const FULL_ACCESS_SCOPES: ApiKeyScope[] = [API_KEY_SUPER_SCOPE];
const DEFAULT_SELECTED_SCOPES: ApiKeyScope[] = [
  "companies.read",
  "routines.read",
  "routines.write",
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.hub",
];
const READ_ONLY_SCOPES: ApiKeyScope[] = [
  "companies.read",
  "profile.read",
  "dashboard.read",
  "people.read",
  "routines.read",
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.read",
  "documents.read",
];
const CODE_AGENT_SCOPES: ApiKeyScope[] = [
  "companies.read",
  "profile.read",
  "dashboard.read",
  "people.read",
  "people.write",
  "routines.read",
  "routines.write",
  "routines.review",
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.read",
  "documents.read",
];
const OPENCLAW_OPERATOR_SCOPES: ApiKeyScope[] = Array.from(
  new Set<ApiKeyScope>([
    "companies.read",
    "companies.members.read",
    "profile.read",
    "profile.write",
    "settings.read",
    "settings.write",
    "dashboard.read",
    "people.read",
    "people.write",
    "routines.read",
    "routines.write",
    "routines.review",
    "company_db.read",
    "company_db.file",
    "company_db.mcp",
    "connectors.read",
    ...CONNECTOR_OPERATOR_API_KEY_SCOPES,
    "documents.read",
    "documents.write",
  ]),
);
const SCOPE_PRESETS: ScopePreset[] = [
  {
    id: "full-access",
    label: "Full access",
    description:
      "Dangerous operator key: all current and future API capabilities within the key's company access.",
    scopes: FULL_ACCESS_SCOPES,
    suggestedName: "Full access agent",
  },
  {
    id: "read-only",
    label: "Read-only",
    description: "Safe default for external analysts and retrieval-only agents.",
    scopes: READ_ONLY_SCOPES,
    suggestedName: "Read-only agent",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    description:
      "Best default for a broad operator that needs dashboard, Company-DB, connectors, and documents.",
    scopes: OPENCLAW_OPERATOR_SCOPES,
    suggestedName: "OpenClaw operator",
  },
  {
    id: "codex",
    label: "Codex",
    description:
      "Lean MCP setup for Codex. Best with a single-company key or a default company.",
    scopes: CODE_AGENT_SCOPES,
    suggestedName: "Codex MCP",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description:
      "Lean MCP setup for Claude Code. Add broader scopes only if the agent must write or use connectors.",
    scopes: CODE_AGENT_SCOPES,
    suggestedName: "Claude Code MCP",
  },
];

const DEFAULT_ACCESS_POLICY_VERSION: ApiKeyAccessPolicyVersion = "access_graph_v1";

const ACCESS_POLICY_DESCRIPTIONS: Record<ApiKeyAccessPolicyVersion, string> = {
  access_graph_v1:
    "Use this for a holding group: the key starts from the selected company and includes approved linked companies with relationship metadata.",
  direct_only:
    "Use this when the agent must see only the selected direct company or selected direct companies.",
  legacy_imported_parent:
    "Compatibility mode for old imported-parent access. Avoid for new organization structure keys.",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isApiKeyExpired(apiKey: Pick<ApiKey, "expiresAt">): boolean {
  return Boolean(apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now());
}

function isApiKeyUsable(apiKey: Pick<ApiKey, "expiresAt" | "isRevoked">): boolean {
  return !apiKey.isRevoked && !isApiKeyExpired(apiKey);
}

export function canGenerateExistingKeySetup(
  apiKey: Pick<ApiKey, "expiresAt" | "isRevoked" | "canRevealSecret">,
  secret: string | null,
): secret is string {
  return Boolean(secret && apiKey.canRevealSecret && isApiKeyUsable(apiKey));
}

function computeExpiresAt(days: string): string | null {
  if (days === "never") return null;
  const d = new Date();
  d.setDate(d.getDate() + parseInt(days, 10));
  return d.toISOString();
}

function getWorkflowResolveEndpoint(accessInfo: AccessInfo): string {
  return accessInfo.endpoints.agentWorkflowResolve ?? `${accessInfo.baseUrl}/api/agent/workflow/resolve`;
}

function getDocumentsEndpoint(accessInfo: AccessInfo): string {
  return accessInfo.endpoints.documents ?? `${accessInfo.baseUrl}/api/documents`;
}

function getDocumentQuestionsEndpoint(accessInfo: AccessInfo): string {
  return accessInfo.endpoints.documentQuestions ?? `${accessInfo.baseUrl}/api/documents/questions`;
}

function getDocumentQuestionsTemplate(accessInfo: AccessInfo): string {
  return (
    accessInfo.endpoints.documentQuestionsTemplate ??
    `${accessInfo.baseUrl}/api/documents/{documentId}/clarifications`
  );
}

function getRoutinesEndpoint(accessInfo: AccessInfo): string {
  return accessInfo.endpoints.routines ?? `${accessInfo.baseUrl}/api/routines`;
}

function getRoutineTemplatesEndpoint(accessInfo: AccessInfo): string {
  return accessInfo.endpoints.routineTemplates ?? `${accessInfo.baseUrl}/api/routines/templates`;
}

function resolveSetupCompanyRef(
  accessInfo: AccessInfo,
  createdKey: CreatedKeyPayload,
): string {
  if (accessInfo.companyId) return accessInfo.companyId;
  if (accessInfo.companySlug) return accessInfo.companySlug;
  if (createdKey.companyScopeMode === "single_company") return "<default-company-id>";
  return "<company-id-or-slug-or-exact-company-name>";
}

function buildCompanyScopeBriefing(
  accessInfo: AccessInfo,
  companyRef: string,
): string[] {
  const policyLine =
    accessInfo.accessPolicyVersion === "access_graph_v1"
      ? "- Access policy version: access_graph_v1. Approved linked companies appear as accessSource=inherited with viaCompanyId, viaCompanySlug, relationshipType, allowedDomains, and allowedConnectorScopes."
      : accessInfo.accessPolicyVersion === "direct_only"
        ? "- Access policy version: direct_only. This key should not receive inherited or linked-company access."
        : "- Access policy version: legacy_imported_parent. This is compatibility mode and does not expose the formal linked-company access graph.";

  return [
    "Company scope contract:",
    `- Company scope mode: ${accessInfo.companyScopeMode}.`,
    policyLine,
    `- Default company_id for examples: ${companyRef}.`,
    "- Always inspect get_session before answering. For linked-structure keys, expect the direct company plus inherited linked companies.",
    "- Prefer the company UUID from get_session/list_companies. If the UUID is not available, company_id may be the company slug or exact company name.",
    "- If a request names another accessible company, resolve it first via get_session/list_companies and pass that company_id explicitly.",
    "- If a tool says company_id is required or not accessible, do not retry blindly; list companies, choose the exact company, then retry once with UUID/slug/exact name.",
  ];
}

function buildServiceBriefing(
  accessInfo: AccessInfo,
  companyRef: string,
): string[] {
  return [
    "Corpus service model to persist in memory:",
    "- Corpus is the operating system and source of truth for company data for this tenant, not just a raw MCP endpoint.",
    "- Primary data surfaces: Company-DB, shared documents, live connectors, agent routes, report jobs, and Document Questions.",
    "- Preferred workflow: get_session -> resolve_workflow -> Company-DB, connectors, report jobs, or documents.",
    "- For historical, imported, or document-backed answers, search Company-DB first.",
    "- For explicit live/source-system requests, list connectors first, then call the relevant connector action.",
    "- For source-backed automations, list routine templates/routines first; use createMode=new when creating an additional automation from an existing template.",
    "- For long-running financial analysis, create a report job instead of looping raw connector calls.",
    "- For uploaded/imported documents, include source context and agent notes, then check Document Questions and answer them before claiming the document is fully understood.",
    "- Before saying data is missing, inspect company scope, Company-DB, documents, Document Questions, and connectors first.",
    `- Agent session endpoint: ${accessInfo.endpoints.agentSession}`,
    `- Workflow router endpoint: ${getWorkflowResolveEndpoint(accessInfo)}`,
    `- Agent MCP endpoint: ${accessInfo.endpoints.agentMcp}`,
    `- Company-DB search endpoint: ${accessInfo.endpoints.search}`,
    `- Connectors endpoint: ${accessInfo.endpoints.agentConnectors}`,
    `- Routines endpoint: ${getRoutinesEndpoint(accessInfo)}`,
    `- Routine templates endpoint: ${getRoutineTemplatesEndpoint(accessInfo)}`,
    `- Documents endpoint: ${getDocumentsEndpoint(accessInfo)}`,
    `- Document Questions endpoint: ${getDocumentQuestionsEndpoint(accessInfo)}`,
    `- Document Questions answer template: ${getDocumentQuestionsTemplate(accessInfo)}`,
    ...buildCompanyScopeBriefing(accessInfo, companyRef),
  ];
}

export function buildCodexBootstrapPrompt(
  accessInfo: AccessInfo,
  createdKey: CreatedKeyPayload,
  companyId: string
): string {
  const codexTomlConfigLines = [
    "[mcp_servers.corpus]",
    `url = "${accessInfo.endpoints.agentMcp}"`,
    `http_headers = { Authorization = "Bearer ${createdKey.key}", "x-company-id" = "${companyId}" }`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 120",
  ];

  return [
    "Set up Corpus in Codex.",
    "Do the work directly on this machine. Be idempotent. Do not print the full API key in your final response.",
    "",
    "Use these exact values:",
    `- CORPUS base URL: ${accessInfo.baseUrl}`,
    `- CORPUS MCP URL: ${accessInfo.endpoints.agentMcp}`,
    `- Company ID: ${companyId}`,
    `- Expected access policy: ${accessInfo.accessPolicyVersion}`,
    `- API key: ${createdKey.key}`,
    "",
    "Do exactly this:",
    "1. First prove the key is valid with REST. If this does not return HTTP 200, stop and report the exact HTTP status; do not continue to MCP debugging.",
    "```bash",
    `CORPUS_APP_URL="${accessInfo.baseUrl}"`,
    `CORPUS_API_KEY="${createdKey.key}"`,
    'curl -sS -o /tmp/corpus-session.json -w "%{http_code}\\n" -H "Authorization: Bearer $CORPUS_API_KEY" "$CORPUS_APP_URL/api/agent/session"',
    "```",
    `2. If REST returns 200, inspect /tmp/corpus-session.json. apiKey.accessPolicyVersion must be "${accessInfo.accessPolicyVersion}". For linked-structure keys, companyAccess.companies should include inherited companies with viaCompanySlug/relationshipType. If it does not, report a wrong key policy instead of configuring MCP.`,
    "3. Create or update only the `[mcp_servers.corpus]` table in `~/.codex/config.toml`. Preserve all unrelated config. The table must be exactly:",
    "```toml",
    ...codexTomlConfigLines,
    "```",
    "4. Run `chmod 600 ~/.codex/config.toml`.",
    "5. Restart/reload Codex after saving config. The current running session may not see a new MCP server until restart.",
    "6. After restart, call Corpus `get_session` first. Then use `resolve_workflow` for non-trivial requests.",
    "",
    "If REST returns 200 but MCP still says Unauthorized, report the likely config/key/restart issue instead of treating Corpus as down.",
    "",
    "Return only a short status:",
    "- REST smoke HTTP status",
    "- observed apiKey.accessPolicyVersion",
    "- whether `[mcp_servers.corpus]` was written",
    "- whether Codex was restarted/reload is still needed",
    "- any blocking issue",
  ].join("\n");
}

export function buildClaudeCodeBootstrapPrompt(
  accessInfo: AccessInfo,
  createdKey: CreatedKeyPayload,
  companyId: string
): string {
  const envLines = [
    `export CORPUS_APP_URL="${accessInfo.baseUrl}"`,
    `export CORPUS_API_KEY="${createdKey.key}"`,
    `export CORPUS_COMPANY_ID="${companyId}"`,
    `export CORPUS_AGENT_MCP_URL="${accessInfo.endpoints.agentMcp}"`,
  ];

  const claudeRestValidationLines = [
    ". ~/.config/corpus/env.sh",
    'curl -sS -H "Authorization: Bearer $CORPUS_API_KEY" "$CORPUS_APP_URL/api/agent/session" | head -c 2000',
  ];
  const claudeConfigureLines = [
    ". ~/.config/corpus/env.sh",
    "if ! command -v claude >/dev/null 2>&1 || ! claude --version >/dev/null 2>&1; then",
    '  echo "Claude Code CLI is not healthy or not installed; Corpus env/memory was still saved."',
    "else",
    '  tmp="${TMPDIR:-/tmp}/corpus-claude-mcp.$$"',
    '  if claude mcp get corpus >"$tmp" 2>&1; then',
    '    if grep -F "$CORPUS_AGENT_MCP_URL" "$tmp" >/dev/null && grep -F "x-company-id" "$tmp" >/dev/null; then',
    '      echo "Claude Code MCP server corpus already exists; leaving it unchanged."',
    "    else",
    '      claude mcp remove corpus && claude mcp add --scope user --transport http corpus "$CORPUS_AGENT_MCP_URL" \\',
    '        --header "Authorization: Bearer $CORPUS_API_KEY" \\',
    '        --header "x-company-id: $CORPUS_COMPANY_ID"',
    "    fi",
    "  else",
    '    claude mcp add --scope user --transport http corpus "$CORPUS_AGENT_MCP_URL" \\',
    '      --header "Authorization: Bearer $CORPUS_API_KEY" \\',
    '      --header "x-company-id: $CORPUS_COMPANY_ID"',
    "  fi",
    '  rm -f "$tmp"',
    "fi",
  ];

  const serviceBriefing = buildServiceBriefing(accessInfo, companyId);

  return [
    "You are bootstrapping permanent Corpus access for future Claude Code sessions on this machine.",
    "Do the work directly on the machine. Be idempotent. Do not print the full API key after saving it.",
    "Scope: only write Corpus env, the Claude Code `corpus` MCP server, and `~/.claude/CLAUDE.md`. If Claude Code itself is missing or unhealthy, save the Corpus files you can and report the local Claude Code issue.",
    "",
    "Use these exact values:",
    `- CORPUS base URL: ${accessInfo.baseUrl}`,
    `- CORPUS MCP URL: ${accessInfo.endpoints.agentMcp}`,
    `- Company ID: ${companyId}`,
    `- Expected access policy: ${accessInfo.accessPolicyVersion}`,
    `- API key: ${createdKey.key}`,
    "",
    "Execute all of the following:",
    "1. Create `~/.config/corpus/env.sh` with mode `600` and write exactly these exports:",
    "```bash",
    ...envLines,
    "```",
    "2. Do not modify `~/.zshrc` or `~/.bashrc` unless an Corpus block already exists and only needs this same env path corrected.",
    "3. Validate direct Corpus REST access before changing Claude Code MCP config:",
    "```bash",
    ...claudeRestValidationLines,
    "```",
    "4. Configure the user-scoped Claude Code MCP server only if the existing Claude Code CLI works. Check an existing `corpus` server before replacing it; do not blindly remove working user config. On any CLI/runtime failure, stop and report it without repairing Claude Code:",
    "```bash",
    ...claudeConfigureLines,
    "```",
    "5. Create or update `~/.claude/CLAUDE.md` so future Claude Code sessions always remember:",
    "   - Corpus MCP server name is `corpus`.",
    "   - Corpus is the primary source for company data, Company-DB, documents, and live connectors.",
    "   - Always start with get_session, then resolve_workflow for non-trivial tasks.",
    "   - Pass company_id explicitly on company-scoped tools; prefer UUID, but slug or exact company name are accepted.",
    "   - Before saying data is unavailable, inspect the Corpus MCP session, company scope, Company-DB, documents, Document Questions, and connectors first.",
    "   - For document uploads, include source context, agent notes, and known clarification answers; then check Document Questions.",
    "   - Prefer direct MCP reads over asking the user for manual exports when CORPUS already has the data.",
    "   - Never print the full API key.",
    "6. If `~/.claude/CLAUDE.md` already exists, preserve existing content and append the new Corpus section once.",
    "7. Validate the setup with one bounded Claude Code MCP check if the CLI is healthy. Do not spawn a nested Claude Code session and do not troubleshoot Claude Code CLI failures:",
    "```bash",
    "if command -v claude >/dev/null 2>&1 && claude --version >/dev/null 2>&1; then",
    "  claude mcp list",
    "  claude mcp get corpus || true",
    "else",
    '  echo "Claude Code CLI is not healthy or not installed; direct Corpus REST validation already ran."',
    "fi",
    "```",
    "8. Persist this exact Corpus context in `~/.claude/CLAUDE.md`:",
    ...serviceBriefing,
    "9. Return a short report with:",
    "   - files created or updated,",
    "   - whether direct Corpus REST smoke worked,",
    "   - whether the `corpus` MCP server is installed for user scope,",
    "   - whether `~/.claude/CLAUDE.md` now contains permanent Corpus instructions,",
    "   - any blocking issue.",
  ].join("\n");
}

export function buildClientSetupSnippets(
  accessInfo: AccessInfo,
  createdKey: CreatedKeyPayload
): ClientSetupSnippet[] {
  const companyId = resolveSetupCompanyRef(accessInfo, createdKey);
  const workflowResolveEndpoint = getWorkflowResolveEndpoint(accessInfo);
  const documentsEndpoint = getDocumentsEndpoint(accessInfo);
  const documentQuestionsEndpoint = getDocumentQuestionsEndpoint(accessInfo);
  const documentQuestionsTemplate = getDocumentQuestionsTemplate(accessInfo);
  const serviceBriefing = buildServiceBriefing(accessInfo, companyId);
  const openClawRemoteSnippet = [
    "Install Corpus as a remote MCP server named `corpus`.",
    "",
    "MCP server config:",
    "```json",
    "{",
    '  "name": "corpus",',
    `  "url": "${accessInfo.endpoints.agentMcp}",`,
    '  "headers": {',
    `    "Authorization": "Bearer ${createdKey.key}",`,
    `    "x-company-id": "${companyId}"`,
    "  }",
    "}",
    "```",
    "",
    "After connecting, validate inside OpenClaw:",
    "1. Call `get_session`.",
    "2. If the target company is ambiguous, call `list_companies` and use the UUID; slug or exact company name also work as `company_id`.",
    `3. Call \`resolve_workflow\` with {"request":"<user task>","company_id":"${companyId}"}.`,
    `4. For imported/company knowledge, call \`search_company_entities\` with {"company_id":"${companyId}","query":"<topic>","limit":5,"view":"summary"}.`,
    "5. Before saying data is missing, inspect Company-DB, documents, Document Questions, and connectors.",
    "",
    ...serviceBriefing,
  ].join("\n");

  const openClawSkillSnippet = [
    "Run from the OpenClaw workspace that should use Corpus. This snippet only writes Corpus config and runs the native OpenClaw skill install when the existing OpenClaw CLI is healthy.",
    "",
    "Install the published Corpus skill with the native OpenClaw skills command when the existing OpenClaw CLI is healthy, then save credentials for local adapter runs:",
    "```bash",
    "if command -v openclaw >/dev/null 2>&1 && openclaw --version >/dev/null 2>&1; then",
    "  openclaw skills install openclaw-corpus-agent --force",
    "else",
    '  echo "OpenClaw CLI is not healthy or not installed; Corpus env will be saved, but skill install must wait until the local OpenClaw CLI works."',
    "fi",
    "",
    "mkdir -p ~/.config/corpus",
    "cat > ~/.config/corpus/env.sh <<'EOF'",
    `export CORPUS_APP_URL="${accessInfo.baseUrl}"`,
    `export CORPUS_API_KEY="${createdKey.key}"`,
    `export CORPUS_COMPANY_ID="${companyId}"`,
    `export CORPUS_AGENT_MCP_URL="${accessInfo.endpoints.agentMcp}"`,
    "EOF",
    "chmod 600 ~/.config/corpus/env.sh",
    ". ~/.config/corpus/env.sh",
    "",
    "node ~/.openclaw/skills/openclaw-corpus-agent/bin/openclaw-corpus-adapter.mjs session",
    "node ~/.openclaw/skills/openclaw-corpus-agent/bin/openclaw-corpus-adapter.mjs tools",
    `node ~/.openclaw/skills/openclaw-corpus-agent/bin/openclaw-corpus-adapter.mjs search '{"company_id":"${companyId}","query":"company overview","limit":5,"view":"summary"}'`,
    `node ~/.openclaw/skills/openclaw-corpus-agent/bin/openclaw-corpus-adapter.mjs document-questions '{"company_id":"${companyId}","limit":10}'`,
    "```",
    "",
    "Agent rules to persist:",
    ...serviceBriefing,
  ].join("\n");

  const codexSnippet = buildCodexBootstrapPrompt(accessInfo, createdKey, companyId);
  const claudeSnippet = buildClaudeCodeBootstrapPrompt(accessInfo, createdKey, companyId);

  const genericRestSnippet = [
    "Use these REST calls as the minimum smoke and workflow contract:",
    "```bash",
    `CORPUS_APP_URL="${accessInfo.baseUrl}"`,
    `CORPUS_API_KEY="${createdKey.key}"`,
    `CORPUS_COMPANY_ID="${companyId}"`,
    "",
    "curl -sS -H \"Authorization: Bearer $CORPUS_API_KEY\" \\",
    "  \"$CORPUS_APP_URL/api/agent/session\"",
    "",
    "curl -sS -X POST \"$CORPUS_APP_URL/api/agent/workflow/resolve\" \\",
    "  -H \"Authorization: Bearer $CORPUS_API_KEY\" \\",
    "  -H \"Content-Type: application/json\" \\",
    "  -d \"{\\\"company_id\\\":\\\"$CORPUS_COMPANY_ID\\\",\\\"request\\\":\\\"company overview\\\"}\"",
    "",
    "curl -sS -G \"$CORPUS_APP_URL/api/company/search\" \\",
    "  -H \"Authorization: Bearer $CORPUS_API_KEY\" \\",
    "  -H \"x-company-id: $CORPUS_COMPANY_ID\" \\",
    "  --data-urlencode \"q=company overview\" \\",
    "  --data-urlencode \"limit=5\" \\",
    "  --data-urlencode \"view=summary\"",
    "",
    "curl -sS -H \"Authorization: Bearer $CORPUS_API_KEY\" \\",
    "  -H \"x-company-id: $CORPUS_COMPANY_ID\" \\",
    "  \"$CORPUS_APP_URL/api/documents/questions?limit=10\"",
    "```",
    "",
    `Workflow endpoint: ${workflowResolveEndpoint}`,
    `Documents endpoint: ${documentsEndpoint}`,
    `Document Questions endpoint: ${documentQuestionsEndpoint}`,
    `Document Questions answer template: ${documentQuestionsTemplate}`,
    "Create an additional source-backed automation intentionally with `POST /api/routines` and body `{\"templateKey\":\"legal_watch_bkpm\",\"createMode\":\"new\",\"createdFrom\":\"api\",\"title\":\"...\"}`.",
    "",
    ...buildCompanyScopeBriefing(accessInfo, companyId),
  ]
    .join("\n");

  const mcpCliSnippet = [
    "Run from an Corpus repo checkout that has dependencies installed:",
    "",
    "This uses an existing Corpus repo checkout with dependencies installed. If the checkout or dependencies are missing, use the REST preset instead.",
    "```bash",
    `export CORPUS_APP_URL="${accessInfo.baseUrl}"`,
    `export CORPUS_API_KEY="${createdKey.key}"`,
    `export CORPUS_COMPANY_ID="${companyId}"`,
    "",
    "node scripts/agent-mcp-cli.mjs session",
    "node scripts/agent-mcp-cli.mjs companies",
    `node scripts/agent-mcp-cli.mjs call-tool resolve_workflow '{"request":"company overview","company_id":"${companyId}"}'`,
    `node scripts/agent-mcp-cli.mjs search "company overview" '{"company_id":"${companyId}","limit":5,"view":"summary"}'`,
    `node scripts/agent-mcp-cli.mjs connectors --company-id "${companyId}"`,
    `node scripts/agent-mcp-cli.mjs documents '{"limit":10}' --company-id "${companyId}"`,
    "```",
    "",
    "If a company-scoped tool returns `company_id is required or not accessible`, run `companies`, select the exact company, then retry with its UUID, slug, or exact name.",
    "",
    "Optional dashboard smoke:",
    "```bash",
    "node scripts/agent-mcp-cli.mjs dashboard \\",
    `  --url ${accessInfo.baseUrl} \\`,
    `  --api-key ${createdKey.key} \\`,
    `  --company-id ${companyId}`,
    "```",
  ].join("\n");

  return [
    {
      id: "openclaw-remote",
      label: "OpenClaw (Remote MCP)",
      description: "Shortest setup. Paste this MCP server config into OpenClaw and connect directly by URL.",
      snippet: openClawRemoteSnippet,
      note:
        "No local repo checkout required. Keep `x-company-id` unless this key is single-company or has the correct default company.",
    },
    {
      id: "openclaw-skill",
      label: "OpenClaw Skill",
      description: "Packaged adapter path for hosts that prefer an installed local skill.",
      snippet: openClawSkillSnippet,
      note:
        "Uses native `openclaw skills install` plus persistent env and smoke commands.",
    },
    {
      id: "codex",
      label: "Codex",
      description: "Paste this into Codex so it validates the key and writes the MCP config.",
      snippet: codexSnippet,
      note:
        "This is a short bootstrap prompt for the agent itself. It uses /api/agent/mcp with bearer auth, writes only ~/.codex/config.toml, and requires Codex restart/reload before MCP is expected to appear.",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      description: "Paste this into Claude Code so it saves the key, wires user-scoped MCP, and persists Corpus memory in ~/.claude/CLAUDE.md.",
      snippet: claudeSnippet,
      note:
        "This is a bootstrap prompt for Claude Code itself. It uses user-scoped MCP config plus persistent Claude memory.",
    },
    {
      id: "mcp-cli",
      label: "MCP CLI",
      description: "Thin local wrapper over /api/agent/mcp for shell-based workflows.",
      snippet: mcpCliSnippet,
      note: "Requires this repository checkout because `scripts/agent-mcp-cli.mjs` lives in Corpus.",
    },
    {
      id: "rest",
      label: "REST",
      description: "Bearer-key smoke and fallback workflow without MCP client setup.",
      snippet: genericRestSnippet,
      note: "REST company-scoped endpoints use `x-company-id`; UUID is preferred, but slug or exact company name are accepted.",
    },
  ];
}

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiration, setNewKeyExpiration] = useState("30");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKeyPayload | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>(DEFAULT_SELECTED_SCOPES);
  const [companyScopeMode, setCompanyScopeMode] =
    useState<ApiKeyCompanyScopeMode>("single_company");
  const [accessPolicyVersion, setAccessPolicyVersion] =
    useState<ApiKeyAccessPolicyVersion>(DEFAULT_ACCESS_POLICY_VERSION);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [selectedClientPreset, setSelectedClientPreset] = useState("openclaw-remote");
  const [openedKey, setOpenedKey] = useState<ExistingKeyDetail | null>(null);
  const [openedKeySecret, setOpenedKeySecret] = useState<string | null>(null);
  const [loadingKeyId, setLoadingKeyId] = useState<string | null>(null);
  const [revealingKeyId, setRevealingKeyId] = useState<string | null>(null);
  const [copiedOpenedKey, setCopiedOpenedKey] = useState(false);
  const [showRevokedKeys, setShowRevokedKeys] = useState(false);

  // Revoke confirmation state
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const openedKeyPanelRef = useRef<HTMLDivElement | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/api-keys");
      if (!res.ok) throw new Error("Failed to fetch API keys");
      const data = await res.json();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch API keys");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    fetch("/api/companies")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setCompanies((data.companies ?? []) as CompanyOption[]);
        setActiveCompanyId((data.activeCompanyId as string | null) ?? null);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const toggleScope = (scope: ApiKeyScope) => {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((value) => value !== scope && value !== API_KEY_SUPER_SCOPE)
        : [...current.filter((value) => value !== API_KEY_SUPER_SCOPE), scope]
    );
  };

  const applyScopePreset = (preset: ScopePreset) => {
    setSelectedScopes(preset.scopes);
    if (!newKeyName.trim()) {
      setNewKeyName(preset.suggestedName);
    }
  };

  const toggleSelectedCompany = (companyId: string) => {
    setSelectedCompanyIds((current) =>
      current.includes(companyId)
        ? current.filter((value) => value !== companyId)
        : [...current, companyId],
    );
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    if (selectedScopes.length === 0) {
      setError("Select at least one scope");
      return;
    }
    if (
      companyScopeMode === "selected_companies" &&
      selectedCompanyIds.length === 0
    ) {
      setError("Select at least one company for selected_companies keys");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName.trim(),
          expiresAt: computeExpiresAt(newKeyExpiration),
          scopes: selectedScopes,
          companyScopeMode,
          accessPolicyVersion,
          allowedCompanyIds:
            companyScopeMode === "selected_companies"
              ? selectedCompanyIds
              : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create API key");
      }

      const data = await res.json();
      setCreatedKey({
        key: data.key,
        access: data.access ?? null,
        scopes: data.scopes ?? [],
        companyScopeMode: data.companyScopeMode ?? "single_company",
        accessPolicyVersion:
          data.accessPolicyVersion ?? DEFAULT_ACCESS_POLICY_VERSION,
        allowedCompanyIds: data.allowedCompanyIds ?? [],
      });
      setNewKeyName("");
      setNewKeyExpiration("30");
      setSelectedScopes(DEFAULT_SELECTED_SCOPES);
      setCompanyScopeMode("single_company");
      setAccessPolicyVersion(DEFAULT_ACCESS_POLICY_VERSION);
      setSelectedCompanyIds([]);
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to revoke API key");
      }
      setRevokeConfirmId(null);
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopySnippet = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedSnippet(label);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const handleDismissCreated = () => {
    setCreatedKey(null);
    setIsCreating(false);
    setCopiedKey(false);
    setCopiedSnippet(null);
  };

  const handleOpenSetup = async (keyId: string) => {
    setLoadingKeyId(keyId);
    setError(null);
    setCopiedSnippet(null);
    setCopiedOpenedKey(false);
    setOpenedKeySecret(null);
    try {
      const res = await fetch(`/api/api-keys/${keyId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load API key setup");
      }
      const data = (await res.json()) as ExistingKeyDetail;
      setOpenedKey(data);
      setSelectedClientPreset("openclaw-remote");
      if (data.canRevealSecret) {
        const revealRes = await fetch(`/api/api-keys/${keyId}/reveal`, {
          method: "POST",
        });
        if (!revealRes.ok) {
          const revealData = await revealRes.json().catch(() => ({}));
          setError(revealData.error || "Setup opened, but failed to reveal API key");
          return;
        }
        const revealData = await revealRes.json();
        setOpenedKeySecret(revealData.key as string);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API key setup");
    } finally {
      setLoadingKeyId(null);
    }
  };

  const handleRevealOpenedKey = async () => {
    if (!openedKey) return;
    setRevealingKeyId(openedKey.id);
    setError(null);
    try {
      const res = await fetch(`/api/api-keys/${openedKey.id}/reveal`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to reveal API key");
      }
      const data = await res.json();
      setOpenedKeySecret(data.key as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reveal API key");
    } finally {
      setRevealingKeyId(null);
    }
  };

  const handleCopyOpenedKey = async () => {
    if (!openedKeySecret) return;
    await navigator.clipboard.writeText(openedKeySecret);
    setCopiedOpenedKey(true);
    setTimeout(() => setCopiedOpenedKey(false), 2000);
  };

  const handleCloseOpenedKey = () => {
    setOpenedKey(null);
    setOpenedKeySecret(null);
    setCopiedOpenedKey(false);
    setCopiedSnippet(null);
  };

  useEffect(() => {
    if (!openedKey) return;
    const frame = requestAnimationFrame(() => {
      openedKeyPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [openedKey]);

  const activeCompany = companies.find((company) => company.id === activeCompanyId) ?? null;
  const fallbackAccess =
    activeCompany && baseUrl
      ? {
          baseUrl,
          companyId: activeCompany.id,
          companySlug: activeCompany.slug,
          companyScopeMode: "single_company" as const,
          accessPolicyVersion: DEFAULT_ACCESS_POLICY_VERSION,
          allowedCompanyIds: [activeCompany.id],
          endpoints: {
            agentSession: `${baseUrl}/api/agent/session`,
            agentCompanies: `${baseUrl}/api/agent/companies`,
            agentCompanyMembers: `${baseUrl}/api/agent/company-members`,
            agentProfile: `${baseUrl}/api/agent/profile`,
            agentSettings: `${baseUrl}/api/agent/settings`,
            agentDashboard: `${baseUrl}/api/agent/dashboard`,
            agentPeople: `${baseUrl}/api/agent/people`,
            agentConnectors: `${baseUrl}/api/agent/connectors`,
            agentMcp: `${baseUrl}/api/agent/mcp`,
            agentWorkflowResolve: `${baseUrl}/api/agent/workflow/resolve`,
            query: `${baseUrl}/api/company/query`,
            search: `${baseUrl}/api/company/search`,
            entity: `${baseUrl}/api/company/entity`,
            file: `${baseUrl}/api/company/file`,
            mcp: `${baseUrl}/api/company/mcp`,
            connectorsHub: `${baseUrl}/api/connectors/hub`,
            connectorsHubLegacy: `${baseUrl}/api/connectors/hub`,
            documents: `${baseUrl}/api/documents`,
            documentsUpload: `${baseUrl}/api/documents/upload`,
            documentsBatchUpload: `${baseUrl}/api/documents/batch-upload`,
            documentQuestions: `${baseUrl}/api/documents/questions`,
            documentQuestionsTemplate: `${baseUrl}/api/documents/{documentId}/clarifications`,
          },
        }
      : null;

  const accessInfo = createdKey?.access ?? fallbackAccess;
  const clientSetupSnippets =
    accessInfo && createdKey
      ? buildClientSetupSnippets(accessInfo, createdKey)
      : [];
  const openedKeySetupSecret = openedKeySecret;
  const openedKeySetupPayload =
    openedKey && canGenerateExistingKeySetup(openedKey, openedKeySetupSecret)
      ? {
          key: openedKeySetupSecret,
          access: openedKey.access,
          scopes: openedKey.scopes,
          companyScopeMode: openedKey.companyScopeMode,
          accessPolicyVersion: openedKey.accessPolicyVersion,
          allowedCompanyIds: openedKey.allowedCompanyIds,
        }
      : null;
  const openedKeyClientSetupSnippets =
    openedKey?.access && openedKeySetupPayload
      ? buildClientSetupSnippets(openedKey.access, openedKeySetupPayload)
      : [];
  const revokedKeyCount = keys.filter((apiKey) => apiKey.isRevoked).length;
  const visibleKeys = showRevokedKeys
    ? keys
    : keys.filter((apiKey) => !apiKey.isRevoked);
  const companyNameById = new Map(
    companies.map((company) => [company.id, company.name] as const),
  );
  const getCompanyName = (companyId: string | null) =>
    companyId ? companyNameById.get(companyId) ?? companyId : null;
  const describeCompanyAccess = (apiKey: ApiKey) => {
    if (apiKey.companyScopeMode === "all_user_companies") {
      return "All accessible companies";
    }
    if (apiKey.companyScopeMode === "selected_companies") {
      const names = apiKey.allowedCompanyIds.map(getCompanyName).filter(Boolean);
      return names.length > 0 ? names.join(", ") : "Selected companies";
    }
    return getCompanyName(apiKey.defaultCompanyId) ?? "Active company";
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>API Keys</CardTitle>
            <CardDescription>
              Create and manage API keys for programmatic access.
            </CardDescription>
          </div>
          {!isCreating && !createdKey && (
            <Button
              size="sm"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="size-4" />
              Create API Key
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Created key display */}
        {createdKey && (
          <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="size-4" />
              Copy this key now. It won&apos;t be shown again.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm text-foreground break-all">
                {createdKey.key}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
              >
                {copiedKey ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copiedKey ? "Copied" : "Copy"}
              </Button>
            </div>
            {accessInfo && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Use these values with this key
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <code className="rounded bg-muted px-3 py-2 font-mono text-xs break-all">
                      Base URL: {accessInfo.baseUrl}
                    </code>
                    <code className="rounded bg-muted px-3 py-2 font-mono text-xs break-all">
                      Company scope: {API_KEY_COMPANY_SCOPE_MODE_LABELS[createdKey.companyScopeMode]}
                    </code>
                    <code className="rounded bg-muted px-3 py-2 font-mono text-xs break-all">
                      Relationship access: {API_KEY_ACCESS_POLICY_VERSION_LABELS[createdKey.accessPolicyVersion]}
                    </code>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">Scopes</p>
                  <div className="flex flex-wrap gap-2">
                    {createdKey.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {API_KEY_SCOPE_LABELS[scope]}
                      </Badge>
                    ))}
                  </div>
                </div>

                {clientSetupSnippets.length > 0 && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-foreground">Client Setup Presets</p>
                      <p className="text-xs text-muted-foreground">
                        Copy-paste the exact setup for OpenClaw, Codex, Claude Code, or the generic MCP wrapper.
                      </p>
                    </div>
                    <Tabs
                      value={selectedClientPreset}
                      onValueChange={setSelectedClientPreset}
                      className="space-y-3"
                    >
                      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
                        {clientSetupSnippets.map((snippet) => (
                          <TabsTrigger
                            key={snippet.id}
                            value={snippet.id}
                            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                          >
                            {snippet.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      {clientSetupSnippets.map((snippet) => (
                        <TabsContent key={snippet.id} value={snippet.id} className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-foreground">{snippet.label}</p>
                              <p className="text-xs text-muted-foreground">{snippet.description}</p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCopySnippet(snippet.id, snippet.snippet)}
                            >
                              {copiedSnippet === snippet.id ? (
                                <Check className="size-4 text-green-500" />
                              ) : (
                                <Copy className="size-4" />
                              )}
                              {copiedSnippet === snippet.id ? "Copied" : "Copy"}
                            </Button>
                          </div>
                          <pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs text-foreground">
                            {snippet.snippet}
                          </pre>
                          {snippet.note && (
                            <p className="text-xs text-muted-foreground">{snippet.note}</p>
                          )}
                        </TabsContent>
                      ))}
                    </Tabs>
                  </div>
                )}
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDismissCreated}
            >
              Done
            </Button>
          </div>
        )}

        {openedKey && (
          <div ref={openedKeyPanelRef} className="rounded-md border border-border bg-muted/40 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  API key setup: {openedKey.name}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Reopen setup details, snippets, and secret reveal for this key.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCloseOpenedKey}>
                Close
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <code className="rounded bg-background px-3 py-2 font-mono text-xs break-all">
                Key prefix: corpus_sk_{openedKey.keyPrefix}...
              </code>
              <code className="rounded bg-background px-3 py-2 font-mono text-xs break-all">
                Company scope: {API_KEY_COMPANY_SCOPE_MODE_LABELS[openedKey.companyScopeMode]}
              </code>
              <code className="rounded bg-background px-3 py-2 font-mono text-xs break-all">
                Relationship access: {API_KEY_ACCESS_POLICY_VERSION_LABELS[openedKey.accessPolicyVersion]}
              </code>
            </div>

            {!isApiKeyUsable(openedKey) && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                This key cannot authenticate because it is {openedKey.isRevoked ? "revoked" : "expired"}. Rotate or create a new key before copying setup.
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">Scopes</p>
              <div className="flex flex-wrap gap-2">
                {openedKey.scopes.map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {API_KEY_SCOPE_LABELS[scope]}
                  </Badge>
                ))}
              </div>
            </div>

            {openedKeySecret ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-3 py-2 font-mono text-sm text-foreground break-all">
                    {openedKeySecret}
                  </code>
                  <Button variant="outline" size="sm" onClick={handleCopyOpenedKey}>
                    {copiedOpenedKey ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    {copiedOpenedKey ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            ) : openedKey.canRevealSecret ? (
              <div className="rounded-md border border-border bg-background p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  The secret is stored encrypted at rest. Reveal it only when you need to copy setup again.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRevealOpenedKey}
                  disabled={revealingKeyId === openedKey.id}
                >
                  {revealingKeyId === openedKey.id && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Reveal key
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
                This is a legacy key. The plaintext secret was not stored and cannot be recovered. Exact setup snippets are disabled to avoid copying a placeholder key. Paste the saved key manually in a new prompt or rotate this key to get exact copy-paste setup.
              </div>
            )}

            {openedKeyClientSetupSnippets.length > 0 ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Client Setup Presets</p>
                  <p className="text-xs text-muted-foreground">
                    Copy the exact setup again for this key.
                  </p>
                </div>
                <Tabs
                  value={selectedClientPreset}
                  onValueChange={setSelectedClientPreset}
                  className="space-y-3"
                >
                  <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
                    {openedKeyClientSetupSnippets.map((snippet) => (
                      <TabsTrigger
                        key={snippet.id}
                        value={snippet.id}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                      >
                        {snippet.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {openedKeyClientSetupSnippets.map((snippet) => (
                    <TabsContent key={snippet.id} value={snippet.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-foreground">{snippet.label}</p>
                          <p className="text-xs text-muted-foreground">{snippet.description}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopySnippet(snippet.id, snippet.snippet)}
                        >
                          {copiedSnippet === snippet.id ? (
                            <Check className="size-4 text-green-500" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                          {copiedSnippet === snippet.id ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      <pre className="overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs text-foreground">
                        {snippet.snippet}
                      </pre>
                      {snippet.note && (
                        <p className="text-xs text-muted-foreground">{snippet.note}</p>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Reveal the key to regenerate copy-paste setup snippets.
              </p>
            )}
          </div>
        )}

        {/* Creation form (inline) */}
        {isCreating && !createdKey && (
          <div className="rounded-md border border-border bg-muted/50 p-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                placeholder="e.g. Production, CI/CD, Development"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-expiration">Expiration</Label>
              <Select
                value={newKeyExpiration}
                onValueChange={setNewKeyExpiration}
              >
                <SelectTrigger id="key-expiration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-scope-mode">Company access</Label>
              <Select
                value={companyScopeMode}
                onValueChange={(value) =>
                  setCompanyScopeMode(value as ApiKeyCompanyScopeMode)
                }
              >
                <SelectTrigger id="company-scope-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_company">Single company</SelectItem>
                  <SelectItem value="selected_companies">Selected companies</SelectItem>
                  <SelectItem value="all_user_companies">All accessible companies</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Single-company keys bind to the active company. Selected-company keys can access only the companies chosen below.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="access-policy-version">Relationship access</Label>
              <Select
                value={accessPolicyVersion}
                onValueChange={(value) =>
                  setAccessPolicyVersion(value as ApiKeyAccessPolicyVersion)
                }
              >
                <SelectTrigger id="access-policy-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="access_graph_v1">
                    {API_KEY_ACCESS_POLICY_VERSION_LABELS.access_graph_v1}
                  </SelectItem>
                  <SelectItem value="direct_only">
                    {API_KEY_ACCESS_POLICY_VERSION_LABELS.direct_only}
                  </SelectItem>
                  <SelectItem value="legacy_imported_parent">
                    {API_KEY_ACCESS_POLICY_VERSION_LABELS.legacy_imported_parent}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ACCESS_POLICY_DESCRIPTIONS[accessPolicyVersion]}
              </p>
            </div>
            {companyScopeMode === "selected_companies" && (
              <div className="space-y-2">
                <Label>Select companies</Label>
                <div className="grid gap-2 md:grid-cols-2">
                  {companies.map((company) => (
                    <label
                      key={company.id}
                      className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCompanyIds.includes(company.id)}
                        onChange={() => toggleSelectedCompany(company.id)}
                      />
                      <span className="flex-1">
                        {company.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {company.role}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Scopes</Label>
              <p className="text-xs text-muted-foreground">
                Use Full access for agent-first operation across all current and future API capabilities.
              </p>
              <div className="flex flex-wrap gap-2">
                {SCOPE_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyScopePreset(preset)}
                    title={preset.description}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedScopes(FULL_ACCESS_SCOPES)}
                >
                  Full access
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedScopes([])}
                >
                  Clear
                </Button>
              </div>
              <label className="flex items-start gap-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(API_KEY_SUPER_SCOPE)}
                  onChange={() =>
                    setSelectedScopes((current) =>
                      current.includes(API_KEY_SUPER_SCOPE) ? [] : FULL_ACCESS_SCOPES,
                    )
                  }
                />
                <span className="space-y-1">
                  <span className="block font-medium text-foreground">
                    {API_KEY_SCOPE_LABELS[API_KEY_SUPER_SCOPE]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    All current and future API capabilities within this key&apos;s company access.
                  </span>
                </span>
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                {SELECTABLE_API_KEY_SCOPE_OPTIONS.map(([scope, label]) => (
                  <label
                    key={scope}
                    className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!newKeyName.trim() || isSubmitting || selectedScopes.length === 0}
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Create
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsCreating(false);
                  setNewKeyName("");
                  setNewKeyExpiration("30");
                  setSelectedScopes(DEFAULT_SELECTED_SCOPES);
                  setCompanyScopeMode("single_company");
                  setAccessPolicyVersion(DEFAULT_ACCESS_POLICY_VERSION);
                  setSelectedCompanyIds([]);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" />
            Loading API keys...
          </div>
        )}

        {/* Empty state */}
        {!isLoading && keys.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Key className="size-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No API keys yet. Create one to access the API programmatically.
            </p>
          </div>
        )}

        {/* Key list */}
        {!isLoading && keys.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {visibleKeys.length} visible API key{visibleKeys.length === 1 ? "" : "s"}
                </p>
                {revokedKeyCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {showRevokedKeys
                      ? "Revoked keys are shown for audit."
                      : `${revokedKeyCount} revoked key${revokedKeyCount === 1 ? "" : "s"} hidden to keep this list clean.`}
                  </p>
                )}
              </div>
              {revokedKeyCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRevokedKeys((value) => !value)}
                >
                  {showRevokedKeys ? "Hide revoked" : `Show revoked (${revokedKeyCount})`}
                </Button>
              )}
            </div>

            {visibleKeys.length === 0 ? (
              <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
                No active API keys. Revoked keys are hidden by default.
              </div>
            ) : (
              <div className="grid gap-3">
                {visibleKeys.map((apiKey) => {
                  const visibleScopes = apiKey.scopes.slice(0, 3);
                  const hiddenScopeCount = Math.max(apiKey.scopes.length - visibleScopes.length, 0);

                  return (
                    <div
                      key={apiKey.id}
                      className={`rounded-md border border-border bg-background p-4 ${
                        apiKey.isRevoked ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{apiKey.name}</p>
                            {apiKey.isRevoked ? (
                              <Badge variant="secondary">Revoked</Badge>
                            ) : isApiKeyExpired(apiKey) ? (
                              <Badge variant="secondary">Expired</Badge>
                            ) : (
                              <Badge className="border-green-600/30 bg-green-600/20 text-green-600 dark:text-green-400">
                                Active
                              </Badge>
                            )}
                          </div>
                          <code className="inline-flex max-w-full rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                            <span className="truncate">corpus_sk_{apiKey.keyPrefix}...</span>
                          </code>
                          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <span className="block font-medium text-foreground">Created</span>
                              {formatDate(apiKey.createdAt)}
                            </div>
                            <div>
                              <span className="block font-medium text-foreground">Last used</span>
                              {formatDate(apiKey.lastUsedAt)}
                            </div>
                            <div className="sm:col-span-2">
                              <span className="block font-medium text-foreground">Company access</span>
                              <span className="break-words">
                                {API_KEY_COMPANY_SCOPE_MODE_LABELS[apiKey.companyScopeMode]}:{" "}
                                {describeCompanyAccess(apiKey)}
                              </span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="block font-medium text-foreground">Relationship access</span>
                              {API_KEY_ACCESS_POLICY_VERSION_LABELS[apiKey.accessPolicyVersion]}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {visibleScopes.map((scope) => (
                              <Badge key={scope} variant="secondary">
                                {API_KEY_SCOPE_LABELS[scope]}
                              </Badge>
                            ))}
                            {hiddenScopeCount > 0 && (
                              <Badge variant="outline">+{hiddenScopeCount} scopes</Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenSetup(apiKey.id)}
                            disabled={loadingKeyId === apiKey.id}
                          >
                            {loadingKeyId === apiKey.id && (
                              <Loader2 className="size-4 animate-spin" />
                            )}
                            View setup
                          </Button>
                          {!apiKey.isRevoked && (
                            <>
                              {revokeConfirmId === apiKey.id ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1">
                                  <span className="text-xs text-destructive">
                                    Delete this key?
                                  </span>
                                  <Button
                                    variant="destructive"
                                    size="xs"
                                    onClick={() => handleRevoke(apiKey.id)}
                                    disabled={revokingId === apiKey.id}
                                  >
                                    {revokingId === apiKey.id ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                      "Delete"
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={() => setRevokeConfirmId(null)}
                                    disabled={revokingId === apiKey.id}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => setRevokeConfirmId(apiKey.id)}
                                >
                                  <Trash2 className="size-4" />
                                  Delete
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
