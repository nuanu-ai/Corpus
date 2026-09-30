/**
 * corpus-side Odoo access policy.
 *
 * Gates which Odoo tools/models an assistant user may invoke, derived from the
 * user's resolved company domain grants (`chatAuth.companyAllowedDomains`).
 * Enforced ENTIRELY on the corpus side — no Odoo/portal changes required
 * (relevant: the Odoo team is not available to tighten groups right now).
 *
 * Why this exists: the Odoo connection uses ONE shared admin token, so without
 * this gate every company member can read all Odoo financials + bank IBANs via
 * the agent. This module restricts the agent's Odoo tool surface per the user's
 * functional domains (purchasing / finance / tax / accounting / banking ...).
 *
 * Semantics:
 *   - `allowedDomains === null | undefined | []`  => no domain restriction =>
 *     full Odoo access (owner/admin/controller), EXCEPT always-denied
 *     HR/payroll models (belt-and-suspenders; Odoo also blocks these).
 *   - non-empty allowedDomains  => enforce: a tool/model is allowed only if the
 *     user holds at least one of its required domains. Unknown models are
 *     default-DENIED for restricted users (security-first; extend MODEL_DOMAINS
 *     to allow more).
 *
 * NOTE: shipping this gate MUST be paired with correct per-role domain-grant
 * assignment in your deployment tooling — otherwise existing
 * finance workflows get denied until grants match roles.
 */

// Functional domains that unlock Odoo capabilities.
export type OdooDomain =
  | "finance" | "accounting" | "banking" | "revenue"
  | "expenses" | "purchasing" | "tax";

// Named Odoo tools -> at least ONE of these domains required to use the tool.
export const TOOL_DOMAINS: Record<string, readonly OdooDomain[]> = {
  odoo_revenue_summary: ["finance", "accounting", "revenue"],
  odoo_pnl_summary: ["finance", "accounting"],
  odoo_vendor_spending: ["finance", "accounting"],
  odoo_recurring_spending: ["finance", "accounting"],
  odoo_purchases_by_period: ["expenses", "purchasing"],
  // search_odoo / get_odoo_record / direct_odoo_lookup are model-gated below.
};

// Odoo models -> at least ONE of these domains required to read the model.
export const MODEL_DOMAINS: Record<string, readonly OdooDomain[]> = {
  "account.move": ["finance", "accounting", "revenue", "tax"],
  "account.move.line": ["finance", "accounting", "revenue", "tax"],
  "account.invoice": ["finance", "accounting", "revenue"],
  "account.payment": ["finance", "accounting", "banking"],
  "account.journal": ["finance", "accounting", "banking"],
  "account.tax": ["tax", "finance", "accounting"],
  "account.analytic.line": ["finance", "accounting"],
  "res.partner.bank": ["banking", "finance"],
  "purchase.order": ["expenses", "purchasing"],
  "purchase.order.line": ["expenses", "purchasing"],
  "stock.move": ["expenses", "purchasing"],
  "stock.quant": ["expenses", "purchasing"],
  "product.product": ["expenses", "purchasing"],
  "product.template": ["expenses", "purchasing"],
  "res.partner": ["finance", "accounting", "revenue", "expenses", "purchasing", "banking", "tax"],
};

// Always denied regardless of domain — salaries/HR must never leak.
export const ALWAYS_DENY_MODELS = [
  "hr.employee", "hr.contract", "hr.payslip", "hr.payslip.line",
  "hr.applicant", "hr.expense", "hr.leave", "hr.holidays",
  "payroll.*",
] as const;

export interface OdooCapabilities {
  /** true when allowedDomains is null/empty (no restriction = full access). */
  fullAccess: boolean;
  domains: Set<string>;
}

export function resolveOdooCapabilities(
  allowedDomains: string[] | null | undefined,
): OdooCapabilities {
  const list = Array.isArray(allowedDomains)
    ? allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean)
    : [];
  return { fullAccess: list.length === 0, domains: new Set(list) };
}

function hasAny(domains: Set<string>, required: readonly string[]): boolean {
  return required.some((d) => domains.has(d));
}

function isAlwaysDenied(model: string): boolean {
  const m = model.trim().toLowerCase();
  return ALWAYS_DENY_MODELS.some((d) => {
    const prefix = d.replace(/\.\*$/, ".");
    return d.endsWith(".*") ? m.startsWith(prefix) : m === d;
  });
}

const GENERIC_TOOLS = new Set(["search_odoo", "get_odoo_record", "direct_odoo_lookup"]);

/**
 * Returns a human-readable denial message if the tool/model is NOT allowed for
 * the given allowedDomains, otherwise `null` (allowed). Designed to be dropped
 * in as a 2-line guard at the top of each Odoo tool's `execute`.
 *
 *   const denied = odooDeniedMessage(chatAuth?.companyAllowedDomains ?? null, "odoo_pnl_summary");
 *   if (denied) return { action: "odoo_pnl" as const, error: denied };
 */
export function odooDeniedMessage(
  allowedDomains: string[] | null | undefined,
  toolName: string,
  model?: string,
): string | null {
  // Kill-switch: set ODOO_ACCESS_GATE_DISABLED=1 to disable the gate instantly
  // (no redeploy) — e.g. if it over-restricts a legitimate workflow.
  if (process.env.ODOO_ACCESS_GATE_DISABLED === "1" || process.env.ODOO_ACCESS_GATE_DISABLED === "true") {
    return null;
  }
  const cap = resolveOdooCapabilities(allowedDomains);

  // Generic tools: gate by the requested Odoo model.
  if (GENERIC_TOOLS.has(toolName)) {
    const m = (model ?? "").trim().toLowerCase();
    if (m && isAlwaysDenied(m)) {
      return `Access denied: Odoo model '${model}' is restricted (HR/payroll).`;
    }
    if (cap.fullAccess) return null;
    const required = m ? MODEL_DOMAINS[m] : undefined;
    if (!required) {
      return `Access denied: Odoo model '${model ?? "(none)"}' is not in your permitted scope.`;
    }
    if (!hasAny(cap.domains, required)) {
      return `Access denied: your role lacks the domain for Odoo model '${model}' (needs one of: ${required.join(", ")}).`;
    }
    return null;
  }

  // Named tools: gate by the tool's required domain.
  if (cap.fullAccess) return null;
  const required = TOOL_DOMAINS[toolName];
  if (required && !hasAny(cap.domains, required)) {
    return `Access denied: your role lacks the domain for '${toolName}' (needs one of: ${required.join(", ")}).`;
  }
  return null;
}
