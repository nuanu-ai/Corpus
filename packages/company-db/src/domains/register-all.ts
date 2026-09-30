import type { DomainEngine, EntityValidator } from "./domain-engine.js";
import type { BaseEntity } from "../schema/domain-types/common.js";
import { registerRevenueValidators } from "./revenue/revenue.js";
import { registerExpenseValidators } from "./expenses/expenses.js";
import { registerTaxValidators } from "./tax/tax.js";
import { registerPeopleValidators } from "./people/people.js";
import { registerOperationsValidators } from "./operations/operations.js";

// ---------------------------------------------------------------------------
// Lightweight validators for domains that only need a field check or two
// ---------------------------------------------------------------------------

function registerProductsValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const data = entity as Record<string, unknown>;
    const errors: string[] = [];

    if (data.type === "prod" || data.type === "product") {
      if (!data.name || (typeof data.name === "string" && data.name.trim() === "")) {
        errors.push("Product must have a name");
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("products", validator);
}

function registerLegalValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const data = entity as Record<string, unknown>;
    const errors: string[] = [];

    if (data.type === "ctr" || data.type === "contract") {
      if (!data.counterparty || (typeof data.counterparty === "string" && data.counterparty.trim() === "")) {
        errors.push("Contract must have a counterparty");
      }
      if (!data.start_date) {
        errors.push("Contract must have a start_date");
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("legal", validator);
}

function registerSecurityValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const data = entity as Record<string, unknown>;
    const errors: string[] = [];

    if (data.type === "incident" || data.type === "security_incident") {
      if (!data.severity) {
        errors.push("Security incident must have a severity");
      }
      if (!data.status) {
        errors.push("Security incident must have a status");
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("security", validator);
}

function registerDocumentsValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const data = entity as Record<string, unknown>;
    const errors: string[] = [];

    if (data.type === "doc" || data.type === "document") {
      if (!data.filename || (typeof data.filename === "string" && data.filename.trim() === "")) {
        errors.push("Document must have a filename");
      }
      if (!data.document_type || (typeof data.document_type === "string" && data.document_type.trim() === "")) {
        errors.push("Document must have a document_type");
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("documents", validator);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Register all domain-specific validators on the engine.
 *
 * This is the single entry point for domain setup. Domains without
 * meaningful validation (projects, knowledge, market, integrations,
 * inventory, assets, bookings, entities) use the generic domain engine
 * as-is with no extra validators.
 */
export function registerAllDomainValidators(engine: DomainEngine): void {
  // Core business domains
  registerRevenueValidators(engine);
  registerExpenseValidators(engine);
  registerTaxValidators(engine);
  registerPeopleValidators(engine);
  registerOperationsValidators(engine);

  // Lightweight validators
  registerProductsValidators(engine);
  registerLegalValidators(engine);
  registerSecurityValidators(engine);
  registerDocumentsValidators(engine);

  // The following domains use the generic engine as-is (no special validators):
  // - identity, governance, strategy (core but no extra validation needed)
  // - finance, banking (have their own specialized modules)
  // - projects, knowledge, market, integrations
  // - inventory, assets, bookings, entities
}
