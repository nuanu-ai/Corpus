// ── Types ────────────────────────────────────────────────────────────────

export type CallerRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer"
  | "cfo_agent"
  | "external_accountant"
  | "investor_view"
  | "partner_agent";

export interface Caller {
  id: string;
  role: CallerRole;
  authenticatedVia: "jwt" | "api_key" | "internal_service";
}

export interface RolePolicy {
  domains: string[];       // "*" or specific domain names
  field_levels: string[];  // e.g. ["public", "internal", "sensitive"]
  can_submit: boolean;
}

export interface ToolPolicy {
  min_role: CallerRole;
  requires?: string; // e.g. "can_submit"
}

export interface PolicyConfig {
  roles: Record<CallerRole, RolePolicy>;
  tools: Record<string, ToolPolicy>;
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
  filteredFields?: string[];
  resolveVault: boolean;
  audit: AccessAuditMeta;
}

export interface AccessAuditMeta {
  callerId: string;
  callerRole: CallerRole;
  authMethod: "jwt" | "api_key" | "internal_service";
  requestedDomain?: string;
  requestedTool?: string;
  decision: "allow" | "deny";
  step: string;
  timestamp: string;
}

// ── Role hierarchy ───────────────────────────────────────────────────────

/**
 * Ordered from most privileged (index 0) to least privileged.
 */
export const ROLE_HIERARCHY: CallerRole[] = [
  "owner",
  "admin",
  "cfo_agent",
  "external_accountant",
  "member",
  "viewer",
  "investor_view",
  "partner_agent",
];

function roleRank(role: CallerRole): number {
  const idx = ROLE_HIERARCHY.indexOf(role);
  return idx === -1 ? Infinity : idx;
}

function isRoleAtLeast(callerRole: CallerRole, minRole: CallerRole): boolean {
  return roleRank(callerRole) <= roleRank(minRole);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMeta(
  caller: Caller,
  request: { domain?: string; tool?: string },
  decision: "allow" | "deny",
  step: string,
): AccessAuditMeta {
  return {
    callerId: caller.id,
    callerRole: caller.role,
    authMethod: caller.authenticatedVia,
    requestedDomain: request.domain,
    requestedTool: request.tool,
    decision,
    step,
    timestamp: new Date().toISOString(),
  };
}

function deny(
  caller: Caller,
  request: { domain?: string; tool?: string },
  step: string,
  reason: string,
): AccessDecision {
  return {
    allowed: false,
    reason,
    resolveVault: false,
    audit: makeMeta(caller, request, "deny", step),
  };
}

// ── All known field levels for vault resolution ─────────────────────────

const VAULT_LEVEL = "restricted";

// ── 7-step evaluation ───────────────────────────────────────────────────

/**
 * Evaluate access for a caller against a request.
 *
 * 7-step algorithm with short-circuit on first failure:
 * 1. AuthN check — caller must have a valid auth method
 * 2. Role resolution — caller.role must exist in policy
 * 3. Tool access — if a tool is requested, caller.role >= tool.min_role OR has required capability
 * 4. Domain scope — requested domain must be in caller's allowed domains
 * 5. Field filtering — strip fields whose level is not in caller's allowed field_levels
 * 6. Vault resolve flag — indicate if PII refs should be inlined
 * 7. Audit — return decision metadata
 *
 * Default = deny.
 */
export function evaluateAccess(
  caller: Caller,
  request: {
    domain?: string;
    tool?: string;
    fields?: string[];        // field names
    fieldLevels?: Record<string, string>; // field name -> level mapping
  },
  policy: PolicyConfig,
): AccessDecision {
  // Step 1: AuthN check
  if (!caller.authenticatedVia || !caller.id) {
    return deny(caller, request, "authn", "Missing authentication credentials");
  }

  if (
    caller.authenticatedVia !== "jwt" &&
    caller.authenticatedVia !== "api_key" &&
    caller.authenticatedVia !== "internal_service"
  ) {
    return deny(caller, request, "authn", `Invalid auth method: ${caller.authenticatedVia}`);
  }

  // Step 2: Role resolution
  const rolePolicy = policy.roles[caller.role];
  if (!rolePolicy) {
    return deny(caller, request, "role_resolution", `Unknown role: ${caller.role}`);
  }

  // Step 3: Tool access
  if (request.tool !== undefined) {
    const toolPolicy = policy.tools[request.tool];
    if (!toolPolicy) {
      return deny(caller, request, "tool_access", `Unknown tool: ${request.tool}`);
    }

    const hasMinRole = isRoleAtLeast(caller.role, toolPolicy.min_role);

    if (!hasMinRole) {
      // Check if the role has the required capability as fallback
      if (toolPolicy.requires) {
        const capKey = toolPolicy.requires;
        if (!(capKey in rolePolicy) || !rolePolicy[capKey as keyof RolePolicy]) {
          return deny(
            caller,
            request,
            "tool_access",
            `Role ${caller.role} lacks min_role (${toolPolicy.min_role}) and required capability (${toolPolicy.requires}) for tool ${request.tool}`,
          );
        }
      } else {
        return deny(
          caller,
          request,
          "tool_access",
          `Role ${caller.role} does not meet min_role ${toolPolicy.min_role} for tool ${request.tool}`,
        );
      }
    }

    // If tool has a "requires" capability and the caller DOES have min_role, still check the requirement
    if (toolPolicy.requires) {
      const capKey = toolPolicy.requires;
      if (!(capKey in rolePolicy) || !rolePolicy[capKey as keyof RolePolicy]) {
        return deny(
          caller,
          request,
          "tool_access",
          `Role ${caller.role} lacks required capability ${toolPolicy.requires} for tool ${request.tool}`,
        );
      }
    }
  }

  // Step 4: Domain scope (prefix matching for sub-domain paths)
  if (request.domain !== undefined) {
    const allowsAll = rolePolicy.domains.includes("*");
    if (!allowsAll) {
      const domainAllowed = rolePolicy.domains.some((allowed) =>
        // "finance" matches "finance", "finance/statements", "finance/ledger"
        // But "finance/statements" must NOT match "finance" (no upward escalation)
        request.domain! === allowed || request.domain!.startsWith(allowed + "/"),
      );
      if (!domainAllowed) {
        return deny(
          caller,
          request,
          "domain_scope",
          `Role ${caller.role} cannot access domain ${request.domain}`,
        );
      }
    }
  }

  // Step 5: Field filtering
  let filteredFields: string[] | undefined;

  if (request.fields && request.fieldLevels) {
    const allowedLevels = new Set(rolePolicy.field_levels);
    filteredFields = request.fields.filter((f) => {
      const level = request.fieldLevels![f];
      // If level is unknown, default to include (public)
      return level === undefined || allowedLevels.has(level);
    });
  } else if (request.fields) {
    // No level mapping provided — pass all fields through
    filteredFields = [...request.fields];
  }

  // Step 6: Vault resolve flag
  const resolveVault = rolePolicy.field_levels.includes(VAULT_LEVEL);

  // Step 7: Audit — return allow decision
  return {
    allowed: true,
    filteredFields,
    resolveVault,
    audit: makeMeta(caller, request, "allow", "complete"),
  };
}
