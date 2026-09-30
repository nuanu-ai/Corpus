import {
  getOperatingEntityRegistry,
} from "@/lib/operating-entities/registry";
import type {
  OperatingEntityObjectType,
  OperatingEntityRecord,
  OperatingEntityRegistry,
} from "@/lib/operating-entities/types";

import type {
  OperatingRelationshipAxis,
  OperatingStructureModel,
  OperatingStructureObject,
  OperatingStructureRelationship,
} from "./types";
import { applyOperatingStructureManifest } from "./manifest";
import type { OperatingStructureManifest } from "./manifest";

const ORGANIZATION_ROOT_OBJECT_ID = "domain:example-holdings";

function relationshipSafeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function relationshipId(
  axis: OperatingRelationshipAxis,
  sourceObjectId: string,
  targetObjectId: string,
  relationshipType: string,
): string {
  return `rel:${relationshipSafeId(`${axis}-${sourceObjectId}-${relationshipType}-${targetObjectId}`)}`;
}

function operatingRelationshipType(targetType: OperatingEntityObjectType): string {
  switch (targetType) {
    case "operating_domain":
      return "contains_operating_domain";
    case "territory":
      return "contains_territory";
    case "project":
      return "contains_project";
    case "line_of_business":
      return "contains_line_of_business";
    case "department":
      return "contains_department";
    default:
      return "contains_operating_object";
  }
}

function sourceEvidence(record: OperatingEntityRecord): Array<Record<string, unknown>> {
  return record.sourceRows.map((row) => ({
    source: row.source,
    rowNumber: row.rowNumber,
    project: row.project,
    legalEntity: row.legalEntity,
  }));
}

function toStructureObject(record: OperatingEntityRecord): OperatingStructureObject {
  return {
    id: record.id,
    canonicalName: record.canonicalName,
    objectType: record.objectType,
    status: record.status,
    aliases: record.aliases,
    parentIds: record.parentIds,
    legalEntityIds: record.legalEntityIds,
    partnerIds: record.partnerIds,
    appCompanyId: null,
    appCompanySlug: null,
    sourceMappings: record.sourceMappings,
    confidence: record.confidence,
    tags: record.tags,
    notes: record.notes,
    sourceRows: record.sourceRows,
    visibility: "internal",
  };
}

function addRelationship(
  relationships: OperatingStructureRelationship[],
  seen: Set<string>,
  relationship: OperatingStructureRelationship,
): void {
  if (seen.has(relationship.id)) return;
  seen.add(relationship.id);
  relationships.push(relationship);
}

export function buildOrganizationOperatingStructureModel(input?: {
  registry?: OperatingEntityRegistry;
  generatedAt?: string;
  manifest?: OperatingStructureManifest | unknown;
}): OperatingStructureModel {
  const registry = input?.registry ?? getOperatingEntityRegistry();
  const generatedAt = input?.generatedAt ?? new Date().toISOString();
  const objects = registry.records.map(toStructureObject);
  const relationships: OperatingStructureRelationship[] = [];
  const seenRelationshipIds = new Set<string>();

  for (const record of registry.records) {
    for (const parentId of record.parentIds) {
      const parent = registry.recordsById.get(parentId);
      if (!parent) continue;
      const relationshipType = operatingRelationshipType(record.objectType);
      addRelationship(relationships, seenRelationshipIds, {
        id: relationshipId("operating", parentId, record.id, relationshipType),
        sourceObjectId: parentId,
        targetObjectId: record.id,
        relationshipType,
        relationshipAxis: "operating",
        status: record.status === "confirmed" ? "confirmed" : "draft",
        confidence: record.confidence,
        createsDataAccess: false,
        evidence: sourceEvidence(record),
      });
    }

    for (const legalEntityId of record.legalEntityIds) {
      if (!registry.recordsById.has(legalEntityId)) continue;
      const relationshipType = "legal_or_accounting_anchor";
      addRelationship(relationships, seenRelationshipIds, {
        id: relationshipId("legal", record.id, legalEntityId, relationshipType),
        sourceObjectId: record.id,
        targetObjectId: legalEntityId,
        relationshipType,
        relationshipAxis: "legal",
        status: record.status === "confirmed" ? "confirmed" : "draft",
        confidence: record.confidence,
        createsDataAccess: false,
        evidence: sourceEvidence(record),
      });
    }

    for (const partnerId of record.partnerIds) {
      if (!registry.recordsById.has(partnerId)) continue;
      const relationshipType = "partner_or_manager";
      addRelationship(relationships, seenRelationshipIds, {
        id: relationshipId("partner", record.id, partnerId, relationshipType),
        sourceObjectId: record.id,
        targetObjectId: partnerId,
        relationshipType,
        relationshipAxis: "partner",
        status: record.status === "confirmed" ? "confirmed" : "draft",
        confidence: record.confidence,
        createsDataAccess: false,
        evidence: sourceEvidence(record),
      });
    }
  }

  const model: OperatingStructureModel = {
    rootObjectId: ORGANIZATION_ROOT_OBJECT_ID,
    generatedAt,
    objects,
    relationships: relationships.sort((left, right) => left.id.localeCompare(right.id)),
    accessEdges: [],
    companyMutations: [],
    warnings: registry.sourceWarnings,
  };

  if (input?.manifest === undefined) return model;
  return applyOperatingStructureManifest(model, input.manifest).model;
}
