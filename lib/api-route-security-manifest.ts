export type ApiRouteAuthMode =
  | "api_key"
  | "mcp_oauth"
  | "public"
  | "session"
  | "session_or_bearer"
  | "signed_internal"
  | "signed_webhook";

export type ApiRouteSecurityClassification = {
  path: string;
  authMode: ApiRouteAuthMode;
  owner: string;
};

export const declaredApiRoutePaths = [
  "/api/admin/codex-default-pool",
  "/api/admin/codex-pools",
  "/api/admin/company-db/[slug]",
  "/api/admin/company-db/[slug]/commits",
  "/api/admin/company-db/[slug]/file",
  "/api/admin/company-db/[slug]/summaries/rebuild",
  "/api/admin/company-domain-grants",
  "/api/admin/marketing-leads",
  "/api/admin/organization/structure",
  "/api/admin/organization/structure/notes",
  "/api/admin/organization/structure/notes/[id]",
  "/api/admin/overview",
  "/api/admin/retry-stuck-documents",
  "/api/admin/session",
  "/api/agent/companies",
  "/api/agent/company-members",
  "/api/agent/connectors",
  "/api/agent/context-pack",
  "/api/agent/dashboard",
  "/api/agent/mcp",
  "/api/agent/people",
  "/api/agent/profile",
  "/api/agent/report-jobs",
  "/api/agent/report-jobs/[id]",
  "/api/agent/report-jobs/[id]/artifacts/[artifactId]",
  "/api/agent/session",
  "/api/agent/settings",
  "/api/agent/workflow/resolve",
  "/api/api-keys",
  "/api/api-keys/[id]",
  "/api/api-keys/[id]/reveal",
  "/api/auth/[...all]",
  "/api/chat",
  "/api/chat/[persona]",
  "/api/chat/artifacts",
  "/api/chat/feedback",
  "/api/chat/inspect-attachment",
  "/api/chat/suggestions",
  "/api/chat/threads",
  "/api/chat/threads/[id]",
  "/api/chat/threads/[id]/approvals",
  "/api/chat/threads/[id]/approvals/[approvalId]",
  "/api/chat/threads/[id]/artifacts",
  "/api/chat/threads/[id]/artifacts/[artifactId]",
  "/api/chat/threads/[id]/artifacts/[artifactId]/share",
  "/api/chatgpt/mcp-v2",
  "/api/chatgpt/mcp-v2/.well-known/oauth-authorization-server",
  "/api/chatgpt/mcp-v2/.well-known/oauth-protected-resource",
  "/api/chatgpt/mcp-v2/[slug]",
  "/api/chatgpt/mcp-v2/[slug]/.well-known/oauth-authorization-server",
  "/api/chatgpt/mcp-v2/[slug]/.well-known/oauth-protected-resource",
  "/api/chatgpt/mcp-v3",
  "/api/chatgpt/mcp-v3/.well-known/oauth-authorization-server",
  "/api/chatgpt/mcp-v3/.well-known/oauth-protected-resource",
  "/api/chatgpt/mcp-v3/[slug]",
  "/api/chatgpt/mcp-v3/[slug]/.well-known/oauth-authorization-server",
  "/api/chatgpt/mcp-v3/[slug]/.well-known/oauth-protected-resource",
  "/api/chatgpt/mcp/[slug]",
  "/api/chatgpt/mcp/[slug]/.well-known/oauth-authorization-server",
  "/api/chatgpt/mcp/[slug]/.well-known/oauth-protected-resource",
  "/api/codex/chat",
  "/api/codex/chat/auth/device/start",
  "/api/codex/chat/auth/device/status",
  "/api/codex/chat/auth/disconnect",
  "/api/codex/chat/auth/save-api-key",
  "/api/codex/chat/auth/status",
  "/api/codex/chat/auth/test",
  "/api/codex/chat/threads",
  "/api/codex/chat/threads/[id]",
  "/api/codex/chat/threads/[id]/artifacts/[artifactId]",
  "/api/codex/chat/threads/[id]/runs",
  "/api/codex/documents",
  "/api/codex/documents/[id]/index",
  "/api/codex/documents/upload",
  "/api/codex/status",
  "/api/communications/signals",
  "/api/communications/signals/[signalId]",
  "/api/companies",
  "/api/companies/[companyId]",
  "/api/companies/[companyId]/members",
  "/api/companies/active",
  "/api/company/entity",
  "/api/company/file",
  "/api/company/mcp",
  "/api/company/query",
  "/api/company/search",
  "/api/connections",
  "/api/connections/[id]",
  "/api/connections/[id]/config",
  "/api/connections/[id]/sync",
  "/api/connections/google-drive/files",
  "/api/connections/google-drive/import",
  "/api/connections/google-drive/resolve-link",
  "/api/connections/oauth/authorize",
  "/api/connections/oauth/callback",
  "/api/connections/plaid/create-link-token",
  "/api/connections/plaid/exchange-token",
  "/api/connections/providers/[provider]/rules",
  "/api/connections/providers/email-ingest",
  "/api/connections/providers/status",
  "/api/connections/telegram/chats",
  "/api/connections/telegram/select-chats",
  "/api/connections/telegram/send-code",
  "/api/connections/telegram/verify-code",
  "/api/connectors/hub",
  "/api/cron/promote-codex-documents",
  "/api/cron/reconcile",
  "/api/cron/retry-stuck-documents",
  "/api/cron/retry-telegram-bot-deliveries",
  "/api/dashboard/commitments",
  "/api/documents",
  "/api/documents/[id]",
  "/api/documents/[id]/audit",
  "/api/documents/[id]/clarifications",
  "/api/documents/[id]/download",
  "/api/documents/[id]/reprocess",
  "/api/documents/[id]/review",
  "/api/documents/batch-upload",
  "/api/documents/questions",
  "/api/documents/status",
  "/api/documents/upload",
  "/api/embed/api-key-ticket",
  "/api/embed/redeem-api-key-ticket",
  "/api/financial/accounts",
  "/api/financial/bank-balances",
  "/api/financial/cash-flow",
  "/api/financial/expenses",
  "/api/financial/overview",
  "/api/financial/pnl",
  "/api/health",
  "/api/i18n/locale",
  "/api/inngest",
  "/api/landing/leads",
  "/api/notifications",
  "/api/onboarding/chat",
  "/api/onboarding/complete",
  "/api/onboarding/profile",
  "/api/onboarding/status",
  "/api/people",
  "/api/personal/chat",
  "/api/personal/chat/artifacts",
  "/api/personal/chat/threads",
  "/api/personal/chat/threads/[id]",
  "/api/personal/chat/threads/[id]/artifacts",
  "/api/personal/chat/threads/[id]/artifacts/[artifactId]",
  "/api/personal/chat/upload",
  "/api/personal/commitments",
  "/api/personal/communications/signals",
  "/api/personal/connections",
  "/api/personal/connections/providers/email-ingest",
  "/api/personal/connections/telegram/chats",
  "/api/personal/connections/telegram/participants",
  "/api/personal/connections/telegram/people-context",
  "/api/personal/connections/telegram/select-chats",
  "/api/personal/connections/telegram/send-code",
  "/api/personal/connections/telegram/verify-code",
  "/api/personal/documents",
  "/api/personal/documents/[id]/download",
  "/api/personal/documents/upload",
  "/api/personal/summary/[domain]",
  "/api/personal/workspaces/[companyId]",
  "/api/personal/workspaces/[companyId]/publish",
  "/api/projects",
  "/api/projects/active",
  "/api/routines",
  "/api/routines/[routineId]",
  "/api/routines/[routineId]/backfill",
  "/api/routines/[routineId]/candidates",
  "/api/routines/[routineId]/candidates/[candidateId]",
  "/api/routines/[routineId]/digests",
  "/api/routines/[routineId]/digests/preview",
  "/api/routines/[routineId]/manifest",
  "/api/routines/[routineId]/manifest/sources/[sourceId]/test",
  "/api/routines/[routineId]/observations",
  "/api/routines/[routineId]/report-jobs",
  "/api/routines/[routineId]/report-jobs/[jobId]/artifacts/[artifactId]",
  "/api/routines/[routineId]/run",
  "/api/routines/[routineId]/runs",
  "/api/routines/[routineId]/runs/[runId]",
  "/api/routines/[routineId]/schedule",
  "/api/routines/[routineId]/sources",
  "/api/routines/[routineId]/sources/[sourceId]",
  "/api/routines/[routineId]/sources/[sourceId]/test",
  "/api/routines/templates",
  "/api/speech/transcribe",
  "/api/summary/accounts",
  "/api/summary/expenses",
  "/api/summary/pnl",
  "/api/telegram-bot/link",
  "/api/transactions",
  "/api/user/provider-keys",
  "/api/webhooks/email-ingest",
  "/api/webhooks/ingest",
  "/api/webhooks/paypal",
  "/api/webhooks/plaid",
  "/api/webhooks/rutter",
  "/api/webhooks/shopify",
  "/api/webhooks/stripe",
  "/api/webhooks/telegram-bot",
  "/api/webhooks/truelayer",
] as const;

const declaredPathSet = new Set<string>(declaredApiRoutePaths);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routePathToRegExp(routePath: string): RegExp {
  const pattern = routePath
    .split("/")
    .map((segment) => {
      if (segment.startsWith("[...") && segment.endsWith("]")) return ".+";
      if (segment.startsWith("[") && segment.endsWith("]")) return "[^/]+";
      return escapeRegex(segment);
    })
    .join("/");
  return new RegExp(`^${pattern}$`);
}

const routePathPatterns = declaredApiRoutePaths.map((path) => ({
  path,
  pattern: routePathToRegExp(path),
}));

function inferOwner(path: string): string {
  const [, , owner = "unknown"] = path.split("/");
  return owner;
}

export function inferApiRouteAuthMode(path: string): ApiRouteAuthMode {
  if (path === "/api/health") return "public";
  if (path === "/api/landing/leads") return "public";
  if (path.startsWith("/api/auth/")) return "public";
  if (path.startsWith("/api/chatgpt/mcp")) return "mcp_oauth";
  if (path === "/api/embed/redeem-api-key-ticket") return "public";
  if (path.startsWith("/api/webhooks/")) return "signed_webhook";
  if (path.startsWith("/api/cron/") || path === "/api/inngest") return "signed_internal";
  if (path.startsWith("/api/agent/")) return "api_key";
  if (
    path.startsWith("/api/company/") ||
    path.startsWith("/api/connectors/") ||
    path === "/api/routines" ||
    path.startsWith("/api/routines/")
  ) return "session_or_bearer";
  return "session";
}

export function classifyApiRoutePath(path: string): ApiRouteSecurityClassification | null {
  if (!declaredPathSet.has(path)) return null;
  return {
    path,
    authMode: inferApiRouteAuthMode(path),
    owner: inferOwner(path),
  };
}

export function classifyApiRoutePathname(pathname: string): ApiRouteSecurityClassification | null {
  const match = routePathPatterns.find((entry) => entry.pattern.test(pathname));
  return match ? classifyApiRoutePath(match.path) : null;
}

export function isPublicApiRouteAtProxy(pathname: string): boolean {
  const classification = classifyApiRoutePathname(pathname);
  return classification !== null && [
    "mcp_oauth",
    "public",
    "signed_internal",
    "signed_webhook",
  ].includes(classification.authMode);
}
