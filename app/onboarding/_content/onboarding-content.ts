/**
 * Onboarding content: company-type buckets, first-workflow buckets,
 * starter questions, trust copy. Lives outside the type system so the
 * content team can edit without a code review for taxonomy changes.
 *
 * Per Architect review §5 — these are UX taxonomy, not types.
 */

export const COMPANY_TYPE_OPTIONS = [
  {
    id: "single_entity",
    label: "Single entity",
    helper: "One company, one set of books.",
  },
  {
    id: "multi_entity_operator",
    label: "Multi-entity operator",
    helper: "A few related companies under one operator.",
  },
  {
    id: "holding_company",
    label: "Holding company",
    helper: "Group with a portfolio of subsidiaries (holding-company pattern).",
  },
  {
    id: "fractional_cfo",
    label: "Fractional CFO",
    helper: "I serve multiple client companies.",
  },
] as const;

export const FIRST_WORKFLOW_OPTIONS = [
  {
    id: "morning_brief",
    label: "Morning Brief",
    helper: "Daily cash, revenue, anomalies, actions to review.",
  },
  {
    id: "board_pack",
    label: "Board Pack",
    helper: "Executive summary, P&L, KPIs, variance commentary.",
  },
  {
    id: "data_room",
    label: "Data Room",
    helper: "Organized source coverage with freshness signals.",
  },
  {
    id: "multi_entity_custom_mcp",
    label: "Multi-entity operations",
    helper: "Roll-up across entities, per-entity drill-down.",
  },
] as const;

/**
 * The 3-4 "value-first" starter questions surfaced as the very first
 * bot card. Per Designer review §1 — invert the script: ask what the
 * user wants answered before asking who they are.
 */
export const STARTER_QUESTIONS = [
  { id: "cash_runway", label: "What is my cash runway?" },
  { id: "last_month_pnl", label: "How did last month's P&L look?" },
  { id: "money_leaks", label: "Where is money leaking?" },
  { id: "open_ended", label: "Something else (type your own)" },
] as const;

export type CompanyTypeOptionId = (typeof COMPANY_TYPE_OPTIONS)[number]["id"];
export type FirstWorkflowOptionId = (typeof FIRST_WORKFLOW_OPTIONS)[number]["id"];
export type StarterQuestionId = (typeof STARTER_QUESTIONS)[number]["id"];

/**
 * Persistent trust line shown under the chat input. Per Designer review §7
 * — keep terse, never modal.
 */
export const TRUST_INPUT_FOOTER =
  "Your data stays in your tenant. Nothing is shared with other customers or used to train models.";
