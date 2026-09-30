export const GUARDRAIL_KEYS = [
  "needs_review_finance_promotion",
  "tenant_fail_closed",
  "chat_direct_write_approval",
  "email_ingest_authenticity",
  "deploy_hard_fail",
] as const;

export type GuardrailKey = (typeof GUARDRAIL_KEYS)[number];
export type GuardrailMode = "off" | "shadow" | "warn_only" | "enforce";

export interface GuardrailDecision {
  key: GuardrailKey;
  configuredMode: GuardrailMode;
  mode: GuardrailMode;
  companyId: string | null;
  companySlug: string | null;
  allowlist: string[];
  allowlistMatched: boolean;
  enforceDowngraded: boolean;
  shouldLog: boolean;
  shouldWarn: boolean;
  shouldEnforce: boolean;
}

interface ResolveGuardrailInput {
  key: GuardrailKey;
  companyId?: string | null;
  companySlug?: string | null;
  defaultMode?: GuardrailMode;
  env?: NodeJS.ProcessEnv;
  allowGlobalEnforce?: boolean;
}

interface LogGuardrailEventInput {
  decision: GuardrailDecision;
  action: string;
  reason?: string;
  details?: Record<string, unknown>;
}

function normalizeEnvToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeMode(
  value: string | null | undefined,
  fallback: GuardrailMode,
): GuardrailMode {
  const normalized = normalizeEnvToken(value ?? "");
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return "off";
  }
  if (normalized === "1" || normalized === "true" || normalized === "enforce") {
    return "enforce";
  }
  if (normalized === "warn" || normalized === "warn_only" || normalized === "warn-only") {
    return "warn_only";
  }
  if (normalized === "shadow" || normalized === "dry_run" || normalized === "dry-run") {
    return "shadow";
  }
  return fallback;
}

function parseList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function keyToEnvPart(key: GuardrailKey): string {
  return key.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function modeEnvNames(key: GuardrailKey): string[] {
  const envPart = keyToEnvPart(key);
  return [
    `CORPUS_GUARDRAIL_${envPart}_MODE`,
    `CORPUS_${envPart}_MODE`,
  ];
}

function allowlistEnvNames(key: GuardrailKey): string[] {
  const envPart = keyToEnvPart(key);
  return [
    `CORPUS_GUARDRAIL_${envPart}_COMPANY_ALLOWLIST`,
    `CORPUS_${envPart}_COMPANY_ALLOWLIST`,
  ];
}

function firstEnvValue(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function matchesAllowlist(input: {
  allowlist: string[];
  companyId: string | null;
  companySlug: string | null;
}): boolean {
  if (input.allowlist.some((entry) => entry === "*" || normalizeEnvToken(entry) === "all")) {
    return true;
  }

  const candidates = new Set(
    [input.companyId, input.companySlug]
      .filter((value): value is string => Boolean(value))
      .map(normalizeEnvToken),
  );
  if (candidates.size === 0) return false;

  return input.allowlist.some((entry) => candidates.has(normalizeEnvToken(entry)));
}

function requiresAllowlist(env: NodeJS.ProcessEnv): boolean {
  return env.CORPUS_GUARDRAIL_ENFORCE_REQUIRES_ALLOWLIST !== "false";
}

export function resolveGuardrailRollout(
  input: ResolveGuardrailInput,
): GuardrailDecision {
  const env = input.env ?? process.env;
  const defaultMode = input.defaultMode ?? "shadow";
  const rawMode =
    firstEnvValue(env, modeEnvNames(input.key)) ??
    env.CORPUS_GUARDRAIL_DEFAULT_MODE;
  const configuredMode = normalizeMode(rawMode, defaultMode);
  const allowlist = parseList(firstEnvValue(env, allowlistEnvNames(input.key)));
  const companyId = input.companyId ?? null;
  const companySlug = input.companySlug ?? null;
  const allowlistMatched = matchesAllowlist({ allowlist, companyId, companySlug });
  const needsAllowlist =
    configuredMode === "enforce" &&
    requiresAllowlist(env) &&
    !input.allowGlobalEnforce;
  const enforceDowngraded = needsAllowlist && !allowlistMatched;
  const mode = enforceDowngraded ? "shadow" : configuredMode;

  return {
    key: input.key,
    configuredMode,
    mode,
    companyId,
    companySlug,
    allowlist,
    allowlistMatched,
    enforceDowngraded,
    shouldLog: mode === "shadow" || mode === "warn_only" || mode === "enforce",
    shouldWarn: mode === "warn_only" || mode === "enforce" || enforceDowngraded,
    shouldEnforce: mode === "enforce",
  };
}

export function guardrailMetadata(decision: GuardrailDecision): Record<string, unknown> {
  return {
    key: decision.key,
    mode: decision.mode,
    configured_mode: decision.configuredMode,
    company_id: decision.companyId,
    company_slug: decision.companySlug,
    allowlist_matched: decision.allowlistMatched,
    enforce_downgraded: decision.enforceDowngraded,
  };
}

export function logGuardrailEvent(input: LogGuardrailEventInput): void {
  if (!input.decision.shouldLog) return;

  const payload = {
    guardrail: input.decision.key,
    action: input.action,
    reason: input.reason ?? null,
    mode: input.decision.mode,
    configuredMode: input.decision.configuredMode,
    companyId: input.decision.companyId,
    companySlug: input.decision.companySlug,
    allowlistMatched: input.decision.allowlistMatched,
    enforceDowngraded: input.decision.enforceDowngraded,
    details: input.details ?? {},
  };

  const line = `[guardrail:${input.decision.key}] ${JSON.stringify(payload)}`;
  if (input.decision.shouldWarn) {
    console.warn(line);
    return;
  }
  console.info(line);
}
