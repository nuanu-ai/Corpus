import type { DomainEngine, EntityValidator } from "../domain-engine.js";
import type { BaseEntity } from "../../schema/domain-types/common.js";
import type { TaxRegistration } from "../../schema/domain-types/other.js";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Register tax-domain validators on the engine.
 *
 * Rules:
 * - filing must have a jurisdiction and tax_type
 */
export function registerTaxValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const errors: string[] = [];
    const data = entity as Record<string, unknown>;

    switch (data.type) {
      case "filing":
      case "tax_filing": {
        if (!data.jurisdiction || (typeof data.jurisdiction === "string" && data.jurisdiction.trim() === "")) {
          errors.push("Tax filing must have a jurisdiction");
        }
        if (!data.tax_type || (typeof data.tax_type === "string" && data.tax_type.trim() === "")) {
          errors.push("Tax filing must have a tax_type");
        }
        break;
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("tax", validator);
}

// ---------------------------------------------------------------------------
// Tax calendar helpers
// ---------------------------------------------------------------------------

/** Standard filing frequencies and their quarterly due dates (month, day). */
const FILING_SCHEDULES: Record<string, Array<{ month: number; day: number; label: string }>> = {
  "income_tax": [
    { month: 4, day: 15, label: "Annual income tax filing" },
  ],
  "sales_tax": [
    { month: 1, day: 31, label: "Q4 sales tax" },
    { month: 4, day: 30, label: "Q1 sales tax" },
    { month: 7, day: 31, label: "Q2 sales tax" },
    { month: 10, day: 31, label: "Q3 sales tax" },
  ],
  "vat": [
    { month: 1, day: 31, label: "Q4 VAT return" },
    { month: 4, day: 30, label: "Q1 VAT return" },
    { month: 7, day: 31, label: "Q2 VAT return" },
    { month: 10, day: 31, label: "Q3 VAT return" },
  ],
  "payroll_tax": [
    { month: 1, day: 31, label: "Q4 payroll tax" },
    { month: 4, day: 30, label: "Q1 payroll tax" },
    { month: 7, day: 31, label: "Q2 payroll tax" },
    { month: 10, day: 31, label: "Q3 payroll tax" },
  ],
};

export interface TaxDeadline {
  jurisdiction: string;
  tax_type: string;
  due_date: string;
  label: string;
}

/**
 * Generate upcoming tax filing deadlines based on active registrations.
 *
 * For each active registration, looks up the standard schedule for that
 * tax_type and generates deadlines for the given year.
 *
 * @param registrations - active tax registrations
 * @param year - the calendar year to generate deadlines for
 * @returns sorted array of deadlines
 */
export function getTaxCalendar(
  registrations: TaxRegistration[],
  year: number,
): TaxDeadline[] {
  const deadlines: TaxDeadline[] = [];

  for (const reg of registrations) {
    if (reg.status !== "active") continue;

    const schedule = FILING_SCHEDULES[reg.tax_type];
    if (!schedule) continue;

    for (const entry of schedule) {
      const mm = String(entry.month).padStart(2, "0");
      const dd = String(entry.day).padStart(2, "0");
      deadlines.push({
        jurisdiction: reg.jurisdiction,
        tax_type: reg.tax_type,
        due_date: `${year}-${mm}-${dd}`,
        label: `${entry.label} — ${reg.jurisdiction}`,
      });
    }
  }

  // Sort by due date
  deadlines.sort((a, b) => a.due_date.localeCompare(b.due_date));

  return deadlines;
}
