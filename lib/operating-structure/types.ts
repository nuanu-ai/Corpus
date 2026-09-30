import type {
  OperatingEntityConfidence,
  OperatingEntityObjectType,
  OperatingEntitySourceMapping,
  OperatingEntitySourceRow,
  OperatingEntityStatus,
} from "@/lib/operating-entities/types";

export type OperatingRelationshipAxis =
  | "operating"
  | "legal"
  | "partner"
  | "alias"
  | "access"
  | "outside_context";

export type OperatingStructureVisibility = "internal" | "public";

export type CompanyAccessEdgeStatus = "draft" | "active" | "revoked";
export type CompanyAccessInheritedRole = "viewer" | "member" | "admin" | "cfo_agent";

export interface OperatingStructureObject {
  id: string;
  canonicalName: string;
  objectType: OperatingEntityObjectType;
  status: OperatingEntityStatus;
  aliases: string[];
  parentIds: string[];
  legalEntityIds: string[];
  partnerIds: string[];
  appCompanyId: string | null;
  appCompanySlug: string | null;
  sourceMappings: OperatingEntitySourceMapping;
  confidence: OperatingEntityConfidence;
  tags: string[];
  notes: string[];
  sourceRows: OperatingEntitySourceRow[];
  visibility: OperatingStructureVisibility;
}

export interface OperatingStructureRelationship {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationshipType: string;
  relationshipAxis: OperatingRelationshipAxis;
  status: "draft" | "confirmed" | "deprecated";
  confidence: OperatingEntityConfidence;
  createsDataAccess: boolean;
  evidence: Array<Record<string, unknown>>;
}

export interface OperatingStructureAccessEdge {
  parentCompanyId: string;
  childCompanyId: string;
  relationshipId: string | null;
  relationshipType: string;
  inheritedRole: CompanyAccessInheritedRole;
  allowedDomains: string[];
  allowedConnectorScopes: string[];
  status: CompanyAccessEdgeStatus;
  source?: string;
  approvedByUserId?: string | null;
  approvedAt?: Date | string | null;
}

export interface OperatingStructureCompanyMutation {
  companyId: string;
  action: "rename" | "add_aliases" | "map_to_operating_object" | "set_parent_company_id";
  payload: Record<string, unknown>;
}

export interface OperatingStructureModel {
  rootObjectId: string;
  generatedAt: string;
  objects: OperatingStructureObject[];
  relationships: OperatingStructureRelationship[];
  accessEdges: OperatingStructureAccessEdge[];
  companyMutations: OperatingStructureCompanyMutation[];
  warnings: string[];
}

export type OperatingStructureValidationSeverity = "error" | "warning";

export interface OperatingStructureValidationIssue {
  severity: OperatingStructureValidationSeverity;
  code: string;
  message: string;
  objectId?: string;
  relationshipId?: string;
  companyId?: string;
}
