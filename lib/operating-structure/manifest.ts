import { z } from "zod";

import type {
  OperatingStructureAccessEdge,
  OperatingStructureCompanyMutation,
  OperatingStructureModel,
} from "./types";

export const operatingStructureAppCompanyMappingSchema = z.object({
  objectId: z.string().min(1),
  companyId: z.string().uuid(),
  companySlug: z.string().min(1).nullable().optional(),
});

export const operatingStructureAccessEdgeSchema = z.object({
  parentCompanyId: z.string().uuid(),
  childCompanyId: z.string().uuid(),
  relationshipId: z.string().min(1).nullable().default(null),
  relationshipType: z.string().min(1),
  inheritedRole: z.enum(["viewer", "member", "admin", "cfo_agent"]).default("viewer"),
  allowedDomains: z.array(z.string().min(1)).default([]),
  allowedConnectorScopes: z.array(z.string().min(1)).default([]),
  status: z.enum(["draft", "active", "revoked"]).default("draft"),
  source: z.string().min(1).optional(),
  approvedByUserId: z.string().nullable().optional(),
  approvedAt: z.coerce.date().nullable().optional(),
}) satisfies z.ZodType<OperatingStructureAccessEdge>;

export const operatingStructureCompanyMutationSchema = z.object({
  companyId: z.string().uuid(),
  action: z.enum(["rename", "add_aliases", "map_to_operating_object", "set_parent_company_id"]),
  payload: z.record(z.string(), z.unknown()).default({}),
}) satisfies z.ZodType<OperatingStructureCompanyMutation>;

export const operatingStructureManifestSchema = z
  .object({
    appCompanyMappings: z.array(operatingStructureAppCompanyMappingSchema).default([]),
    accessEdges: z.array(operatingStructureAccessEdgeSchema).default([]),
    companyMutations: z.array(operatingStructureCompanyMutationSchema).default([]),
    parentCompanyMutationApproved: z.boolean().default(false),
  })
  .superRefine((manifest, ctx) => {
    const objectIds = new Set<string>();
    const companyIds = new Set<string>();
    manifest.appCompanyMappings.forEach((mapping, index) => {
      if (objectIds.has(mapping.objectId)) {
        ctx.addIssue({
          code: "custom",
          path: ["appCompanyMappings", index, "objectId"],
          message: `Duplicate app-company mapping objectId: ${mapping.objectId}`,
        });
      }
      objectIds.add(mapping.objectId);

      if (companyIds.has(mapping.companyId)) {
        ctx.addIssue({
          code: "custom",
          path: ["appCompanyMappings", index, "companyId"],
          message: `Duplicate app-company mapping companyId: ${mapping.companyId}`,
        });
      }
      companyIds.add(mapping.companyId);
    });
  });

export type OperatingStructureManifest = z.infer<typeof operatingStructureManifestSchema>;

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function normalizeAccessEdge(edge: OperatingStructureAccessEdge): OperatingStructureAccessEdge {
  return {
    ...edge,
    relationshipId: edge.relationshipId ?? null,
    allowedDomains: uniqueSorted(edge.allowedDomains),
    allowedConnectorScopes: uniqueSorted(edge.allowedConnectorScopes),
    approvedByUserId: edge.approvedByUserId ?? null,
    approvedAt: edge.approvedAt ?? null,
  };
}

export function applyOperatingStructureManifest(
  model: OperatingStructureModel,
  manifestInput: unknown,
): { model: OperatingStructureModel; manifest: OperatingStructureManifest } {
  const manifest = operatingStructureManifestSchema.parse(manifestInput ?? {});
  const mappingsByObjectId = new Map(
    manifest.appCompanyMappings.map((mapping) => [mapping.objectId, mapping]),
  );

  const mappedObjects = model.objects.map((object) => {
    const mapping = mappingsByObjectId.get(object.id);
    if (!mapping) return object;
    return {
      ...object,
      appCompanyId: mapping.companyId,
      appCompanySlug: mapping.companySlug ?? object.appCompanySlug,
    };
  });

  const missingMappings = manifest.appCompanyMappings
    .filter((mapping) => !model.objects.some((object) => object.id === mapping.objectId))
    .map((mapping) => mapping.objectId)
    .sort();

  return {
    manifest,
    model: {
      ...model,
      objects: mappedObjects,
      accessEdges: manifest.accessEdges.map(normalizeAccessEdge),
      companyMutations: manifest.companyMutations,
      warnings: [
        ...model.warnings,
        ...missingMappings.map((objectId) =>
          `manifest app-company mapping ignored because object ${objectId} does not exist`,
        ),
      ],
    },
  };
}
