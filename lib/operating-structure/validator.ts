import type {
  OperatingStructureModel,
  OperatingStructureValidationIssue,
} from "./types";

const FORBIDDEN_DATA_ACCESS_RELATIONSHIP_TYPES = new Set([
  "legal_or_contracting_entity",
  "legal_or_accounting_anchor",
  "partner_or_manager",
  "alias_of",
  "merge_candidate",
  "external_owner_confirmed",
  "outside_perimeter_reference",
]);

function addIssue(
  issues: OperatingStructureValidationIssue[],
  issue: OperatingStructureValidationIssue,
): void {
  issues.push(issue);
}

function hasCycle(edges: Array<[string, string]>): string[] | null {
  const graph = new Map<string, string[]>();
  for (const [source, target] of edges) {
    graph.set(source, [...(graph.get(source) ?? []), target]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    if (visiting.has(node)) {
      const index = stack.indexOf(node);
      return [...stack.slice(index), node];
    }
    if (visited.has(node)) return null;

    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

export function validateOperatingStructureModel(
  model: OperatingStructureModel,
  input?: {
    parentCompanyMutationAllowed?: boolean;
  },
): OperatingStructureValidationIssue[] {
  const issues: OperatingStructureValidationIssue[] = [];
  const objectsById = new Map(model.objects.map((object) => [object.id, object]));
  const relationshipsById = new Map(
    model.relationships.map((relationship) => [relationship.id, relationship]),
  );
  const objectIds = new Set<string>();
  const relationshipIds = new Set<string>();
  const mappedAppCompanyIds = new Set(
    model.objects
      .map((object) => object.appCompanyId)
      .filter((companyId): companyId is string => Boolean(companyId)),
  );

  for (const object of model.objects) {
    if (objectIds.has(object.id)) {
      addIssue(issues, {
        severity: "error",
        code: "duplicate_object_id",
        message: `Duplicate operating object id: ${object.id}`,
        objectId: object.id,
      });
    }
    objectIds.add(object.id);
  }

  const appCompanyObjectIds = new Map<string, string>();
  for (const object of model.objects) {
    if (!object.appCompanyId) continue;
    const existingObjectId = appCompanyObjectIds.get(object.appCompanyId);
    if (existingObjectId && existingObjectId !== object.id) {
      addIssue(issues, {
        severity: "error",
        code: "duplicate_app_company_mapping",
        message: `App company ${object.appCompanyId} is mapped to multiple operating objects: ${existingObjectId}, ${object.id}`,
        objectId: object.id,
        companyId: object.appCompanyId,
      });
    }
    appCompanyObjectIds.set(object.appCompanyId, object.id);
  }

  for (const relationship of model.relationships) {
    if (relationshipIds.has(relationship.id)) {
      addIssue(issues, {
        severity: "error",
        code: "duplicate_relationship_id",
        message: `Duplicate operating relationship id: ${relationship.id}`,
        relationshipId: relationship.id,
      });
    }
    relationshipIds.add(relationship.id);

    if (!objectsById.has(relationship.sourceObjectId)) {
      addIssue(issues, {
        severity: "error",
        code: "missing_relationship_source",
        message: `Relationship ${relationship.id} points to missing source ${relationship.sourceObjectId}`,
        relationshipId: relationship.id,
      });
    }
    if (!objectsById.has(relationship.targetObjectId)) {
      addIssue(issues, {
        severity: "error",
        code: "missing_relationship_target",
        message: `Relationship ${relationship.id} points to missing target ${relationship.targetObjectId}`,
        relationshipId: relationship.id,
      });
    }

    if (
      relationship.createsDataAccess &&
      (relationship.relationshipAxis !== "access" ||
        FORBIDDEN_DATA_ACCESS_RELATIONSHIP_TYPES.has(relationship.relationshipType))
    ) {
      addIssue(issues, {
        severity: "error",
        code: "relationship_cannot_create_data_access",
        message: `Relationship ${relationship.id} cannot create runtime data access`,
        relationshipId: relationship.id,
      });
    }

  }

  const operatingEdges = model.relationships
    .filter((relationship) => relationship.relationshipAxis === "operating")
    .map((relationship): [string, string] => [
      relationship.sourceObjectId,
      relationship.targetObjectId,
    ]);
  const cycle = hasCycle(operatingEdges);
  if (cycle) {
    addIssue(issues, {
      severity: "error",
      code: "operating_graph_cycle",
      message: `Operating graph cycle detected: ${cycle.join(" -> ")}`,
    });
  }

  const activeAccessEdgeKeys = new Set<string>();
  for (const edge of model.accessEdges) {
    const relationship = edge.relationshipId ? relationshipsById.get(edge.relationshipId) : null;
    if (edge.parentCompanyId === edge.childCompanyId) {
      addIssue(issues, {
        severity: "error",
        code: "access_edge_self_reference",
        message: `Access edge ${edge.parentCompanyId} -> ${edge.childCompanyId} points to itself`,
        companyId: edge.childCompanyId,
      });
    }
    if (!edge.relationshipId) {
      addIssue(issues, {
        severity: "error",
        code: "access_edge_missing_relationship_id",
        message: `Access edge ${edge.parentCompanyId} -> ${edge.childCompanyId} must reference a generated operating relationship`,
        companyId: edge.childCompanyId,
      });
    } else if (!relationship) {
      addIssue(issues, {
        severity: "error",
        code: "access_edge_relationship_missing",
        message: `Access edge references missing generated relationship ${edge.relationshipId}`,
        relationshipId: edge.relationshipId,
        companyId: edge.childCompanyId,
      });
    } else {
      const sourceObject = objectsById.get(relationship.sourceObjectId);
      const targetObject = objectsById.get(relationship.targetObjectId);
      if (relationship.relationshipAxis !== "operating") {
        addIssue(issues, {
          severity: "error",
          code: "access_edge_relationship_not_operating",
          message: `Access edge relationship ${relationship.id} is ${relationship.relationshipAxis}, not operating`,
          relationshipId: relationship.id,
          companyId: edge.childCompanyId,
        });
      }
      if (edge.relationshipType !== relationship.relationshipType) {
        addIssue(issues, {
          severity: "error",
          code: "access_edge_relationship_type_mismatch",
          message: `Access edge relationship type ${edge.relationshipType} does not match generated relationship ${relationship.relationshipType}`,
          relationshipId: relationship.id,
          companyId: edge.childCompanyId,
        });
      }
      if (
        !sourceObject ||
        !targetObject ||
        sourceObject.appCompanyId !== edge.parentCompanyId ||
        targetObject.appCompanyId !== edge.childCompanyId
      ) {
        addIssue(issues, {
          severity: "error",
          code: "access_edge_relationship_mapping_mismatch",
          message: `Access edge ${edge.parentCompanyId} -> ${edge.childCompanyId} does not match relationship ${relationship.id} source/target app-company mappings`,
          relationshipId: relationship.id,
          companyId: edge.childCompanyId,
        });
      }
    }
    if (!mappedAppCompanyIds.has(edge.parentCompanyId)) {
      addIssue(issues, {
        severity: "error",
        code: "access_edge_parent_company_unmapped",
        message: `Access edge parent company ${edge.parentCompanyId} is not mapped to an operating object`,
        companyId: edge.parentCompanyId,
      });
    }
    if (!mappedAppCompanyIds.has(edge.childCompanyId)) {
      addIssue(issues, {
        severity: "error",
        code: "access_edge_child_company_unmapped",
        message: `Access edge child company ${edge.childCompanyId} is not mapped to an operating object`,
        companyId: edge.childCompanyId,
      });
    }
    if (edge.status === "active" && edge.allowedDomains.length === 0) {
      addIssue(issues, {
        severity: "error",
        code: "active_access_edge_without_domains",
        message: `Active access edge ${edge.parentCompanyId} -> ${edge.childCompanyId} has no allowed domains`,
        companyId: edge.childCompanyId,
      });
    }
    if (edge.status === "active") {
      const edgeKey = `${edge.parentCompanyId}|${edge.childCompanyId}|${edge.relationshipType}`;
      if (activeAccessEdgeKeys.has(edgeKey)) {
        addIssue(issues, {
          severity: "error",
          code: "duplicate_active_access_edge",
          message: `Duplicate active access edge ${edge.parentCompanyId} -> ${edge.childCompanyId} (${edge.relationshipType})`,
          companyId: edge.childCompanyId,
        });
      }
      activeAccessEdgeKeys.add(edgeKey);
    }
    if (FORBIDDEN_DATA_ACCESS_RELATIONSHIP_TYPES.has(edge.relationshipType)) {
      addIssue(issues, {
        severity: "error",
        code: "forbidden_access_edge_relationship_type",
        message: `Access edge relationship type ${edge.relationshipType} must not grant runtime data access`,
        companyId: edge.childCompanyId,
      });
    }
  }

  for (const mutation of model.companyMutations) {
    if (mutation.action === "set_parent_company_id" && !input?.parentCompanyMutationAllowed) {
      addIssue(issues, {
        severity: "error",
        code: "parent_company_mutation_blocked",
        message:
          "parentCompanyId mutations are blocked until access-graph resolver deployment and API-key migration dry-run approval",
        companyId: mutation.companyId,
      });
    }
  }

  return issues;
}
