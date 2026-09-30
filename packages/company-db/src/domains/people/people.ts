import type { DomainEngine, EntityValidator } from "../domain-engine.js";
import type { BaseEntity } from "../../schema/domain-types/common.js";
import type { Employee, Agent, Team } from "../../schema/domain-types/people.js";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Register people-domain validators on the engine.
 *
 * Rules:
 * - employee must have a name and a role
 * - agent must have capabilities (non-empty array)
 */
export function registerPeopleValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const errors: string[] = [];
    const data = entity as Record<string, unknown>;

    switch (data.type) {
      case "emp":
      case "employee": {
        if (!data.name || (typeof data.name === "string" && data.name.trim() === "")) {
          errors.push("Employee must have a name");
        }
        if (!data.role || (typeof data.role === "string" && data.role.trim() === "")) {
          errors.push("Employee must have a role");
        }
        break;
      }
      case "agt":
      case "agent": {
        if (!Array.isArray(data.capabilities) || data.capabilities.length === 0) {
          errors.push("Agent must have at least one capability");
        }
        break;
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("people", validator);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Type guard: returns true if the resource is a human employee. */
export function isHuman(resource: BaseEntity): resource is Employee {
  const data = resource as Record<string, unknown>;
  return data.resource_type === "human" || data.type === "emp" || data.type === "employee";
}

/** Type guard: returns true if the resource is an AI agent. */
export function isAgent(resource: BaseEntity): resource is Agent {
  const data = resource as Record<string, unknown>;
  return data.resource_type === "agent" || data.type === "agt" || data.type === "agent";
}

// ---------------------------------------------------------------------------
// Team helpers
// ---------------------------------------------------------------------------

/**
 * Resolve team member IDs to full resource entities.
 *
 * @param team - a Team entity with a members array of IDs
 * @param resources - all available resources (employees + agents)
 * @returns resources that are members of the given team
 */
export function getTeamMembers(
  team: Team,
  resources: BaseEntity[],
): BaseEntity[] {
  const memberIds = new Set(team.members);
  return resources.filter((r) => memberIds.has(r.id));
}
