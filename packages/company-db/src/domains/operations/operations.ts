import type { DomainEngine, EntityValidator } from "../domain-engine.js";
import type { BaseEntity } from "../../schema/domain-types/common.js";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Register operations-domain validators on the engine.
 *
 * Rules:
 * - facility must have a name and a facility_type
 */
export function registerOperationsValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const errors: string[] = [];
    const data = entity as Record<string, unknown>;

    switch (data.type) {
      case "loc":
      case "facility": {
        if (!data.name || (typeof data.name === "string" && data.name.trim() === "")) {
          errors.push("Facility must have a name");
        }
        if (!data.facility_type && !data.type) {
          errors.push("Facility must have a type");
        }
        break;
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("operations", validator);
}
