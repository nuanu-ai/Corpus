import type { RepoHandle } from "../git/types.js";
import type { PeriodStatus } from "../schema/domain-types/common.js";
import { parseQmd } from "../qmd/parser.js";
import { readFile } from "../git/repo-manager.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface AccessRule {
  agent_pattern: string;
  domains: string[];
  permissions: string[];
}

export interface AccessControls {
  rules: AccessRule[];
}

export interface AgentProfile {
  id: string;
  type: string;
  name: string;
  status: "active" | "inactive" | "revoked";
  domains: string[];
  permissions: string[];
}

export interface WritePermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface PeriodCloseInfo {
  period: string;
  status: PeriodStatus;
  closed_at?: string;
  closed_by?: string;
}

// ── Path validation ──────────────────────────────────────────────────────

const PATH_TRAVERSAL_PATTERN = /(?:^|[/\\])\.\.(?:[/\\]|$)/;

function containsPathTraversal(filePath: string): boolean {
  return PATH_TRAVERSAL_PATTERN.test(filePath);
}

/**
 * Extract the top-level domain from a file path.
 * E.g. "finance/ledger/journal-entries/je-00001.qmd" -> "finance"
 */
function extractDomain(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const firstSegment = normalized.split("/")[0];
  return firstSegment || null;
}

// ── Pattern matching ─────────────────────────────────────────────────────

/**
 * Match an agent ID against a pattern.
 * Supports:
 *   - Exact match:  "agt-001" matches "agt-001"
 *   - Prefix glob:  "agt-*"  matches "agt-001", "agt-042"
 *   - Universal:    "*"      matches everything
 */
function matchesAgentPattern(agentId: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return agentId.startsWith(prefix);
  }
  return agentId === pattern;
}

// ── Core functions ───────────────────────────────────────────────────────

/**
 * Read and parse `.schema/access-controls.qmd` from a repo.
 */
export async function loadAccessControls(
  repo: RepoHandle
): Promise<AccessControls> {
  const raw = await readFile(repo, ".schema/access-controls.qmd");
  if (raw === null) {
    return { rules: [] };
  }

  const doc = parseQmd<AccessControls>(raw, { strict: true });
  const rules = doc.frontmatter.rules;

  if (!Array.isArray(rules)) {
    return { rules: [] };
  }

  return { rules };
}

/**
 * Read and parse an agent profile from `people/resources/agt-{NNN}.qmd`.
 * The agentId should be the full ID e.g. "agt-001".
 */
export async function loadAgentProfile(
  repo: RepoHandle,
  agentId: string
): Promise<AgentProfile | null> {
  // Validate agentId format to prevent path traversal
  if (containsPathTraversal(agentId) || agentId.includes("/") || agentId.includes("\\")) {
    return null;
  }

  const raw = await readFile(repo, `people/resources/${agentId}.qmd`);
  if (raw === null) {
    return null;
  }

  const doc = parseQmd<AgentProfile>(raw);
  return doc.frontmatter;
}

/**
 * Check if an agent can write to the given paths.
 *
 * Logic:
 * 1. Agent profile must be active
 * 2. All file paths are checked for path traversal attacks
 * 3. Match agent against rules in order (first match wins)
 * 4. Check that each requested path's domain is in the matched rule's domains
 * 5. Check that "write" permission is in the matched rule's permissions
 * 6. Cross-check against agent profile's own domains
 * 7. If no rule matches, deny
 */
export function checkWritePermission(
  agentId: string,
  paths: string[],
  controls: AccessControls,
  profile: AgentProfile
): WritePermissionResult {
  // 1. Check agent status
  if (profile.status !== "active") {
    return {
      allowed: false,
      reason: `Agent ${agentId} is ${profile.status} — access denied`,
    };
  }

  // 2. Check for path traversal in all paths
  for (const p of paths) {
    if (containsPathTraversal(p)) {
      return {
        allowed: false,
        reason: `Path traversal detected in "${p}" — access denied`,
      };
    }
  }

  // 3. Find the first matching rule
  const matchedRule = controls.rules.find((rule) =>
    matchesAgentPattern(agentId, rule.agent_pattern)
  );

  if (!matchedRule) {
    return {
      allowed: false,
      reason: `No access rule matches agent ${agentId} — default deny`,
    };
  }

  // 4. Check "write" permission in the matched rule
  if (!matchedRule.permissions.includes("write")) {
    return {
      allowed: false,
      reason: `Rule for ${matchedRule.agent_pattern} does not grant write permission`,
    };
  }

  // 5. Check that each path's domain is in the rule's allowed domains
  const ruleAllowsAllDomains = matchedRule.domains.includes("*");

  for (const p of paths) {
    const domain = extractDomain(p);
    if (!domain) {
      return {
        allowed: false,
        reason: `Cannot determine domain from path "${p}" — access denied`,
      };
    }

    // Check rule-level domain permission
    if (!ruleAllowsAllDomains && !matchedRule.domains.includes(domain)) {
      return {
        allowed: false,
        reason: `Agent ${agentId} rule allows domains [${matchedRule.domains.join(", ")}] but path "${p}" targets domain "${domain}"`,
      };
    }

    // 6. Cross-check against agent profile's domains (role escalation prevention)
    const profileAllowsAllDomains = profile.domains.includes("*");
    if (!profileAllowsAllDomains && !profile.domains.includes(domain)) {
      return {
        allowed: false,
        reason: `Agent ${agentId} profile does not include domain "${domain}" — role escalation denied`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a period is locked (soft_closed or hard_closed).
 * Reads `finance/ledger/periods/{period}-close.qmd`.
 */
export async function checkPeriodLock(
  repo: RepoHandle,
  period: string
): Promise<{ locked: boolean; status: PeriodStatus; reason?: string }> {
  // Validate period format to prevent path traversal
  if (containsPathTraversal(period) || period.includes("/") || period.includes("\\")) {
    return {
      locked: true,
      status: "hard_closed",
      reason: `Invalid period identifier "${period}"`,
    };
  }

  const raw = await readFile(
    repo,
    `finance/ledger/periods/${period}-close.qmd`
  );

  if (raw === null) {
    // No close file means the period is open
    return { locked: false, status: "open" };
  }

  const doc = parseQmd<PeriodCloseInfo>(raw);
  const status = doc.frontmatter.status ?? "open";

  if (status === "soft_closed" || status === "hard_closed") {
    return {
      locked: true,
      status,
      reason: `Period ${period} is ${status}`,
    };
  }

  return { locked: false, status };
}
