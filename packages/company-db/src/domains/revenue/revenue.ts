import type { DomainEngine, EntityValidator } from "../domain-engine.js";
import type { BaseEntity } from "../../schema/domain-types/common.js";
import type { Subscription } from "../../schema/domain-types/revenue.js";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Register revenue-domain validators on the engine.
 *
 * Rules:
 * - customer must have a name
 * - invoice must have at least one line_item
 * - subscription must have a customer_id
 */
export function registerRevenueValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const errors: string[] = [];
    const data = entity as Record<string, unknown>;

    switch (data.type) {
      case "cust":
      case "customer": {
        if (!data.name || (typeof data.name === "string" && data.name.trim() === "")) {
          errors.push("Customer must have a name");
        }
        break;
      }
      case "inv":
      case "invoice": {
        const items = data.line_items;
        if (!Array.isArray(items) || items.length === 0) {
          errors.push("Invoice must have at least one line item");
        }
        break;
      }
      case "sub":
      case "subscription": {
        if (!data.customer_id) {
          errors.push("Subscription must have a customer_id");
        }
        break;
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("revenue", validator);
}

// ---------------------------------------------------------------------------
// MRR / Churn / NRR helpers
// ---------------------------------------------------------------------------

/**
 * Calculate Monthly Recurring Revenue from a list of active subscriptions.
 * Only includes subscriptions with status "active".
 * Annual and quarterly subscriptions are normalized to monthly.
 */
export function calculateMRR(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((s) => s.status === "active")
    .reduce((total, s) => {
      const amount = s.mrr.amount;
      switch (s.billing_cycle) {
        case "annual":
          return total + amount / 12;
        case "quarterly":
          return total + amount / 3;
        case "monthly":
        default:
          return total + amount;
      }
    }, 0);
}

/**
 * Calculate churn rate for a given period.
 *
 * churn_rate = (canceled_in_period / total_at_start) * 100
 *
 * @param subscriptions - all subscriptions (active + canceled)
 * @param period - { start: ISO date, end: ISO date }
 * @returns churn rate as a percentage (0-100)
 */
export function calculateChurnRate(
  subscriptions: Subscription[],
  period: { start: string; end: string },
): number {
  const startDate = new Date(period.start);
  const endDate = new Date(period.end);

  // Subscriptions active at the start of the period
  const activeAtStart = subscriptions.filter((s) => {
    const subStart = new Date(s.start_date);
    return subStart <= startDate && (s.status === "active" || s.status === "canceled");
  });

  if (activeAtStart.length === 0) return 0;

  // Canceled during the period
  const canceledInPeriod = subscriptions.filter((s) => {
    if (s.status !== "canceled" || !s.end_date) return false;
    const cancelDate = new Date(s.end_date);
    return cancelDate >= startDate && cancelDate <= endDate;
  });

  return (canceledInPeriod.length / activeAtStart.length) * 100;
}

/**
 * Calculate Net Revenue Retention (NRR) for a period.
 *
 * NRR = (MRR_end - MRR_new) / MRR_start * 100
 *
 * Where MRR_new = MRR from subscriptions that started during the period.
 *
 * @returns NRR as a percentage (e.g. 105 = 105% retention)
 */
export function calculateNRR(
  subscriptions: Subscription[],
  period: { start: string; end: string },
): number {
  const startDate = new Date(period.start);
  const endDate = new Date(period.end);

  // Helper to normalize MRR to monthly
  const monthlyMRR = (s: Subscription): number => {
    const amount = s.mrr.amount;
    switch (s.billing_cycle) {
      case "annual":
        return amount / 12;
      case "quarterly":
        return amount / 3;
      default:
        return amount;
    }
  };

  // Cohort: subscriptions that existed at the start of the period
  const cohort = subscriptions.filter((s) => {
    const subStart = new Date(s.start_date);
    return subStart <= startDate;
  });

  const mrrStart = cohort
    .filter((s) => s.status === "active" || s.status === "canceled")
    .reduce((sum, s) => sum + monthlyMRR(s), 0);

  if (mrrStart === 0) return 0;

  // MRR at end from the same cohort (still active at end)
  const mrrEnd = cohort
    .filter((s) => {
      if (s.status === "canceled" && s.end_date) {
        return new Date(s.end_date) > endDate;
      }
      return s.status === "active";
    })
    .reduce((sum, s) => sum + monthlyMRR(s), 0);

  return (mrrEnd / mrrStart) * 100;
}
