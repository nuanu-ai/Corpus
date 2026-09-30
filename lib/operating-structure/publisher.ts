import { and, eq } from "drizzle-orm";

import { submitAgentCommit } from "@/lib/company-db/client";
import { queuePortFor } from "@/lib/company-db/port-config";
import { db } from "@/lib/db";
import { companyAccessEdges } from "@/lib/db/schema";

import {
  buildOperatingObjectQmd,
  buildOperatingRelationshipQmd,
  operatingObjectPath,
  operatingRelationshipPath,
} from "./qmd";
import type {
  CompanyAccessEdgeStatus,
  OperatingStructureAccessEdge,
  OperatingStructureModel,
  OperatingStructureValidationIssue,
} from "./types";
import { validateOperatingStructureModel } from "./validator";

const DEFAULT_OPERATING_STRUCTURE_AGENT_ID = "operating-structure-agent";

export interface OperatingStructurePublishInput {
  companyId: string;
  companySlug: string;
  companyDbPort: number;
  model: OperatingStructureModel;
  actorUserId: string;
  dryRun?: boolean;
  parentCompanyMutationAllowed?: boolean;
  agentId?: string;
  commitMessage?: string;
}

export interface OperatingStructurePublishFile {
  path: string;
  content: string;
}

export interface OperatingStructureAccessMutation {
  action: "insert_active" | "update_active" | "revoke_active" | "skip_draft";
  parentCompanyId: string;
  childCompanyId: string;
  relationshipType: string;
  status: CompanyAccessEdgeStatus;
  edgeId?: string;
}

export interface OperatingStructurePublishResult {
  dryRun: boolean;
  commitSha: string | null;
  validationIssues: OperatingStructureValidationIssue[];
  fileCount: number;
  files: OperatingStructurePublishFile[];
  accessEdgeMutations: OperatingStructureAccessMutation[];
}

function buildPublishFiles(model: OperatingStructureModel): OperatingStructurePublishFile[] {
  return [
    ...model.objects.map((object) => ({
      path: operatingObjectPath(object),
      content: buildOperatingObjectQmd(object),
    })),
    ...model.relationships.map((relationship) => ({
      path: operatingRelationshipPath(relationship),
      content: buildOperatingRelationshipQmd(relationship),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeEdge(edge: OperatingStructureAccessEdge, actorUserId: string) {
  return {
    parentCompanyId: edge.parentCompanyId,
    childCompanyId: edge.childCompanyId,
    relationshipId: edge.relationshipId,
    relationshipType: edge.relationshipType,
    inheritedRole: edge.inheritedRole,
    allowedDomains: [...new Set(edge.allowedDomains)].sort(),
    allowedConnectorScopes: [...new Set(edge.allowedConnectorScopes)].sort(),
    status: edge.status,
    source: edge.source ?? "operating_structure_publisher",
    approvedByUserId: edge.approvedByUserId ?? actorUserId,
    approvedAt: edge.approvedAt ? new Date(edge.approvedAt) : new Date(),
    updatedAt: new Date(),
  };
}

async function materializeAccessEdges(
  input: OperatingStructurePublishInput,
): Promise<OperatingStructureAccessMutation[]> {
  const mutations: OperatingStructureAccessMutation[] = [];
  if (input.model.accessEdges.length === 0) return mutations;

  await db.transaction(async (tx) => {
    for (const accessEdge of input.model.accessEdges) {
      if (accessEdge.status === "draft") {
        mutations.push({
          action: "skip_draft",
          parentCompanyId: accessEdge.parentCompanyId,
          childCompanyId: accessEdge.childCompanyId,
          relationshipType: accessEdge.relationshipType,
          status: accessEdge.status,
        });
        continue;
      }

      const [existing] = await tx
        .select({ id: companyAccessEdges.id })
        .from(companyAccessEdges)
        .where(
          and(
            eq(companyAccessEdges.parentCompanyId, accessEdge.parentCompanyId),
            eq(companyAccessEdges.childCompanyId, accessEdge.childCompanyId),
            eq(companyAccessEdges.relationshipType, accessEdge.relationshipType),
            eq(companyAccessEdges.status, "active"),
          ),
        )
        .limit(1);

      if (accessEdge.status === "revoked") {
        if (existing) {
          await tx
            .update(companyAccessEdges)
            .set({
              status: "revoked",
              updatedAt: new Date(),
            })
            .where(eq(companyAccessEdges.id, existing.id));
        }
        mutations.push({
          action: "revoke_active",
          parentCompanyId: accessEdge.parentCompanyId,
          childCompanyId: accessEdge.childCompanyId,
          relationshipType: accessEdge.relationshipType,
          status: accessEdge.status,
          edgeId: existing?.id,
        });
        continue;
      }

      const normalized = normalizeEdge(accessEdge, input.actorUserId);
      if (existing) {
        await tx
          .update(companyAccessEdges)
          .set(normalized)
          .where(eq(companyAccessEdges.id, existing.id));
        mutations.push({
          action: "update_active",
          parentCompanyId: accessEdge.parentCompanyId,
          childCompanyId: accessEdge.childCompanyId,
          relationshipType: accessEdge.relationshipType,
          status: accessEdge.status,
          edgeId: existing.id,
        });
        continue;
      }

      const [inserted] = await tx
        .insert(companyAccessEdges)
        .values(normalized)
        .returning({ id: companyAccessEdges.id });
      mutations.push({
        action: "insert_active",
        parentCompanyId: accessEdge.parentCompanyId,
        childCompanyId: accessEdge.childCompanyId,
        relationshipType: accessEdge.relationshipType,
        status: accessEdge.status,
        edgeId: inserted?.id,
      });
    }
  });

  return mutations;
}

function dryRunAccessMutations(
  accessEdges: OperatingStructureAccessEdge[],
): OperatingStructureAccessMutation[] {
  return accessEdges.map((edge) => ({
    action: edge.status === "draft"
      ? "skip_draft"
      : edge.status === "revoked"
        ? "revoke_active"
        : "insert_active",
    parentCompanyId: edge.parentCompanyId,
    childCompanyId: edge.childCompanyId,
    relationshipType: edge.relationshipType,
    status: edge.status,
  }));
}

export async function publishOperatingStructure(
  input: OperatingStructurePublishInput,
): Promise<OperatingStructurePublishResult> {
  const validationIssues = validateOperatingStructureModel(input.model, {
    parentCompanyMutationAllowed: input.parentCompanyMutationAllowed,
  });
  const blockingIssues = validationIssues.filter((issue) => issue.severity === "error");
  const files = buildPublishFiles(input.model);

  if (blockingIssues.length > 0) {
    return {
      dryRun: Boolean(input.dryRun),
      commitSha: null,
      validationIssues,
      fileCount: files.length,
      files,
      accessEdgeMutations: [],
    };
  }

  if (input.dryRun) {
    return {
      dryRun: true,
      commitSha: null,
      validationIssues,
      fileCount: files.length,
      files,
      accessEdgeMutations: dryRunAccessMutations(input.model.accessEdges),
    };
  }

  const commit = await submitAgentCommit(
    input.companySlug,
    {
      agentId:
        input.agentId ??
        process.env.OPERATING_STRUCTURE_AGENT_ID ??
        DEFAULT_OPERATING_STRUCTURE_AGENT_ID,
      domain: "entities",
      files,
      commitMessage:
        input.commitMessage ??
        `entities(operating-structure): publish ${input.model.rootObjectId}`,
      metadata: {
        source: "operating-structure-publisher",
        rootObjectId: input.model.rootObjectId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        objectCount: input.model.objects.length,
        relationshipCount: input.model.relationships.length,
        accessEdgeCount: input.model.accessEdges.length,
      },
    },
    queuePortFor(input.companyDbPort),
  );

  const accessEdgeMutations = await materializeAccessEdges(input);

  return {
    dryRun: false,
    commitSha: commit.commitSha,
    validationIssues,
    fileCount: files.length,
    files,
    accessEdgeMutations,
  };
}
