import { toQmd } from "@/lib/company-db/summary/qmd";

import type {
  OperatingStructureObject,
  OperatingStructureRelationship,
} from "./types";

export function operatingStructureFileId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

export function operatingObjectPath(object: Pick<OperatingStructureObject, "id">): string {
  return `entities/operating-objects/${operatingStructureFileId(object.id)}.qmd`;
}

export function operatingRelationshipPath(
  relationship: Pick<OperatingStructureRelationship, "id">,
): string {
  return `entities/operating-relationships/${operatingStructureFileId(relationship.id)}.qmd`;
}

function section(title: string, lines: string[]): string {
  const body = lines.filter(Boolean);
  if (body.length === 0) return "";
  return [`## ${title}`, "", ...body].join("\n");
}

function list(values: string[]): string[] {
  if (values.length === 0) return [];
  return values.map((value) => `- ${value}`);
}

export function buildOperatingObjectQmd(object: OperatingStructureObject): string {
  const frontmatter = {
    type: "operating_object",
    id: object.id,
    canonical_name: object.canonicalName,
    object_type: object.objectType,
    status: object.status,
    aliases: object.aliases,
    app_company_id: object.appCompanyId,
    app_company_slug: object.appCompanySlug,
    source_mappings: object.sourceMappings,
    confidence: object.confidence,
    tags: object.tags,
    visibility: object.visibility,
    updated_at: new Date().toISOString(),
  };

  const body = [
    section("Context", object.notes.length ? object.notes : ["No operating notes published."]),
    section("Parent Objects", list(object.parentIds)),
    section("Legal Anchors", list(object.legalEntityIds)),
    section("Partners", list(object.partnerIds)),
    section(
      "Source Rows",
      object.sourceRows.map(
        (row) =>
          `- ${row.source} row ${row.rowNumber}: ${row.project || "n/a"} / ${row.legalEntity || "n/a"}`,
      ),
    ),
  ].filter(Boolean).join("\n\n");

  return toQmd(frontmatter, body);
}

export function buildOperatingRelationshipQmd(
  relationship: OperatingStructureRelationship,
): string {
  const frontmatter = {
    type: "operating_relationship",
    id: relationship.id,
    source_object_id: relationship.sourceObjectId,
    target_object_id: relationship.targetObjectId,
    relationship_type: relationship.relationshipType,
    relationship_axis: relationship.relationshipAxis,
    status: relationship.status,
    confidence: relationship.confidence,
    creates_data_access: relationship.createsDataAccess,
    evidence: relationship.evidence,
    updated_at: new Date().toISOString(),
  };

  const body = [
    "## Relationship",
    "",
    `- Source: ${relationship.sourceObjectId}`,
    `- Target: ${relationship.targetObjectId}`,
    `- Axis: ${relationship.relationshipAxis}`,
    `- Creates data access: ${relationship.createsDataAccess ? "yes" : "no"}`,
  ].join("\n");

  return toQmd(frontmatter, body);
}
