import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { NoCompanyError, UnauthorizedError } from "@/lib/errors";
import { db } from ".";
import { companies, companyMemberDomainGrants, companyMembers } from "./schema";

export type TenantKind = "company" | "person";
export type SchemaPack = "company" | "person";

export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string | null;
  tenantKind: TenantKind;
  schemaPack: SchemaPack;
  tenantDbPort: number;
  tenantSettings: Record<string, unknown> | null;
  jurisdiction?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  website?: string | null;
  aliases?: string[];
  reportingCurrency?: string | null;
  role: string;
  joinedAt: Date;
}

export interface CompanyMembership {
  companyId: string;
  companyName: string;
  companySlug: string | null;
  companyDbPort: number;
  companySettings: Record<string, unknown> | null;
  jurisdiction?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  website?: string | null;
  aliases?: string[];
  reportingCurrency?: string | null;
  role: string;
  joinedAt: Date;
  accessSource?: "direct" | "api_key_parent" | "inherited";
  viaCompanyId?: string | null;
  viaCompanyName?: string | null;
  viaCompanySlug?: string | null;
  relationshipType?: string | null;
  relationshipId?: string | null;
  allowedDomains?: string[] | null;
  domainAccessLevels?: CompanyDomainAccessLevelMap | null;
  allowedConnectorScopes?: string[] | null;
  domainAccessSource?: CompanyDomainAccessSource | null;
  pathEdgeIds?: string[] | null;
  inheritedAccessPaths?: CompanyAccessPathProvenance[] | null;
}

export type CompanyDomainAccessSource =
  | "role_full"
  | "explicit_grants"
  | "no_grants"
  | "inherited"
  | "api_key_parent";

export const COMPANY_DOMAIN_ACCESS_LEVELS = [
  "metadata",
  "read",
  "file",
  "write",
  "admin",
] as const;
export type CompanyDomainAccessLevel = typeof COMPANY_DOMAIN_ACCESS_LEVELS[number];
export type CompanyDomainAccessLevelMap = Record<string, CompanyDomainAccessLevel>;

export interface CompanyDomainPolicy {
  allowedDomains: string[] | null;
  accessLevels: CompanyDomainAccessLevelMap | null;
  source: CompanyDomainAccessSource;
}

export interface CompanyAccessPathProvenance {
  accessSource: "inherited";
  role: string;
  viaCompanyId: string;
  viaCompanyName: string | null;
  viaCompanySlug: string | null;
  relationshipType: string | null;
  relationshipId: string | null;
  allowedDomains: string[];
  domainAccessLevels?: CompanyDomainAccessLevelMap | null;
  allowedConnectorScopes: string[];
  pathEdgeIds: string[];
}

type AccessGraphRow = {
  companyId: string;
  companyName: string;
  companySlug: string | null;
  companyDbPort: number;
  companySettings: Record<string, unknown> | null;
  jurisdiction?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  website?: string | null;
  aliases?: string[];
  reportingCurrency?: string | null;
  role: string;
  joinedAt: Date;
  viaCompanyId: string;
  viaCompanyName: string | null;
  viaCompanySlug: string | null;
  relationshipId: string | null;
  relationshipType: string;
  allowedDomains: string[];
  allowedConnectorScopes: string[];
  pathEdgeIds: string[];
  depth: number;
};

function normalizeTenantKind(value: string | null | undefined): TenantKind {
  return value === "person" ? "person" : "company";
}

function normalizeSchemaPack(value: string | null | undefined): SchemaPack {
  return value === "person" ? "person" : "company";
}

function mapTenantMembership(row: {
  tenantId: string;
  tenantName: string;
  tenantSlug: string | null;
  tenantKind: string;
  schemaPack: string;
  tenantDbPort: number;
  tenantSettings: Record<string, unknown> | null;
  jurisdiction?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  website?: string | null;
  aliases?: string[];
  reportingCurrency?: string | null;
  role: string;
  joinedAt: Date;
}): TenantMembership {
  return {
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tenantSlug: row.tenantSlug,
    tenantKind: normalizeTenantKind(row.tenantKind),
    schemaPack: normalizeSchemaPack(row.schemaPack),
    tenantDbPort: row.tenantDbPort,
    tenantSettings: row.tenantSettings,
    jurisdiction: row.jurisdiction ?? null,
    entityType: row.entityType ?? null,
    businessType: row.businessType ?? null,
    website: row.website ?? null,
    aliases: row.aliases ?? [],
    reportingCurrency: row.reportingCurrency ?? null,
    role: row.role,
    joinedAt: row.joinedAt,
  };
}

async function selectTenantMemberships(
  userId: string,
  tenantKind?: TenantKind,
): Promise<TenantMembership[]> {
  const rows = await db
    .select({
      tenantId: companies.id,
      tenantName: companies.name,
      tenantSlug: companies.slug,
      tenantKind: companies.tenantKind,
      schemaPack: companies.schemaPack,
      tenantDbPort: companies.companyDbPort,
      tenantSettings: companies.settings,
      jurisdiction: companies.jurisdiction,
      entityType: companies.entityType,
      businessType: companies.businessType,
      website: companies.website,
      aliases: companies.aliases,
      reportingCurrency: companies.reportingCurrency,
      role: companyMembers.role,
      joinedAt: companyMembers.createdAt,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(
      tenantKind
        ? and(eq(companyMembers.userId, userId), eq(companies.tenantKind, tenantKind))
        : eq(companyMembers.userId, userId),
    )
    .orderBy(
      asc(companyMembers.createdAt),
      asc(companies.createdAt),
    );

  return rows.map(mapTenantMembership);
}

export async function listTenantMemberships(userId: string): Promise<TenantMembership[]> {
  return selectTenantMemberships(userId);
}

export async function listCompanyMemberships(userId: string): Promise<CompanyMembership[]> {
  const memberships = await selectTenantMemberships(userId, "company");
  const domainPolicies = await resolveCompanyDomainPolicies(
    userId,
    memberships.map((membership) => ({
      companyId: membership.tenantId,
      role: membership.role,
    })),
  );

  return memberships.map((membership) => {
    const policy =
      domainPolicies.get(membership.tenantId) ??
      resolveCompanyDomainPolicyFromGrants(membership.role, []);
    return {
      companyId: membership.tenantId,
      companyName: membership.tenantName,
      companySlug: membership.tenantSlug,
      companyDbPort: membership.tenantDbPort,
      companySettings: membership.tenantSettings,
      jurisdiction: membership.jurisdiction ?? null,
      entityType: membership.entityType ?? null,
      businessType: membership.businessType ?? null,
      website: membership.website ?? null,
      aliases: membership.aliases ?? [],
      reportingCurrency: membership.reportingCurrency ?? null,
      role: membership.role,
      joinedAt: membership.joinedAt,
      allowedDomains: policy.allowedDomains,
      domainAccessLevels: policy.accessLevels,
      domainAccessSource: policy.source,
    };
  });
}

type ImportedChildCompanyRow = {
  companyId: string;
  companyName: string;
  companySlug: string | null;
  companyDbPort: number;
  companySettings: Record<string, unknown> | null;
  jurisdiction?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  website?: string | null;
  aliases?: string[];
  reportingCurrency?: string | null;
  parentCompanyId: string | null;
};

const MAX_IMPORTED_PARENT_EXPANSION_DEPTH = 8;
const MAX_ACCESS_GRAPH_DEPTH = 8;
const FULL_DOMAIN_ACCESS_ROLES = new Set(["owner", "admin"]);
const DOMAIN_ACCESS_LEVEL_RANK: Record<CompanyDomainAccessLevel, number> = {
  metadata: 0,
  read: 1,
  file: 2,
  write: 3,
  admin: 4,
};

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function normalizeCompanyDomain(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "*") return normalized;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) return null;
  return normalized;
}

export function normalizeCompanyDomainAccessLevel(
  value: string | null | undefined,
): CompanyDomainAccessLevel {
  return COMPANY_DOMAIN_ACCESS_LEVELS.includes(value as CompanyDomainAccessLevel)
    ? (value as CompanyDomainAccessLevel)
    : "read";
}

function strongestDomainAccessLevel(
  left: CompanyDomainAccessLevel | null | undefined,
  right: CompanyDomainAccessLevel,
): CompanyDomainAccessLevel {
  if (!left) return right;
  return DOMAIN_ACCESS_LEVEL_RANK[left] >= DOMAIN_ACCESS_LEVEL_RANK[right]
    ? left
    : right;
}

function domainAccessLevelForDomain(
  levels: CompanyDomainAccessLevelMap | null | undefined,
  domain: string,
): CompanyDomainAccessLevel | null {
  if (!levels) return null;
  return levels[domain] ?? levels["*"] ?? null;
}

function hasFullDomainAccess(membership: CompanyMembership): boolean {
  return (
    membership.domainAccessSource === "role_full" ||
    (
      membership.allowedDomains == null &&
      membership.domainAccessLevels == null &&
      FULL_DOMAIN_ACCESS_ROLES.has(membership.role)
    )
  );
}

function deriveInheritedDomainAccessPolicy(
  root: CompanyMembership | undefined,
  allowedDomains: string[],
): { allowedDomains: string[]; accessLevels: CompanyDomainAccessLevelMap } | null {
  if (!root) return null;

  const result: CompanyDomainAccessLevelMap = {};
  for (const domain of allowedDomains) {
    const level = hasFullDomainAccess(root)
      ? "admin"
      : domainAccessLevelForDomain(root.domainAccessLevels, domain);
    if (level) {
      result[domain] = level;
    }
  }
  const resolvedDomains = uniqueSorted(Object.keys(result));
  return resolvedDomains.length > 0
    ? { allowedDomains: resolvedDomains, accessLevels: result }
    : null;
}

function mergeDomainAccessLevelMaps(
  left: CompanyDomainAccessLevelMap | null | undefined,
  right: CompanyDomainAccessLevelMap | null | undefined,
): CompanyDomainAccessLevelMap | null {
  if (left == null && right == null) return null;
  if (left == null) return right ? { ...right } : null;
  if (right == null) return { ...left };
  const result: CompanyDomainAccessLevelMap = { ...left };
  for (const [domain, level] of Object.entries(right)) {
    result[domain] = strongestDomainAccessLevel(result[domain], level);
  }
  return result;
}

export function resolveCompanyDomainPolicyFromGrants(
  role: string,
  grants: readonly (string | { domain: string; accessLevel?: string | null })[],
): CompanyDomainPolicy {
  if (FULL_DOMAIN_ACCESS_ROLES.has(role)) {
    return { allowedDomains: null, accessLevels: null, source: "role_full" };
  }

  const accessLevels: CompanyDomainAccessLevelMap = {};
  for (const grant of grants) {
    const domain = normalizeCompanyDomain(
      typeof grant === "string" ? grant : grant.domain,
    );
    if (!domain) continue;
    const accessLevel = normalizeCompanyDomainAccessLevel(
      typeof grant === "string" ? "read" : grant.accessLevel,
    );
    accessLevels[domain] = strongestDomainAccessLevel(accessLevels[domain], accessLevel);
  }

  const allowedDomains = uniqueSorted(
    Object.keys(accessLevels).filter((domain) => domain !== "*"),
  );
  if (accessLevels["*"]) {
    return {
      allowedDomains: null,
      accessLevels,
      source: "explicit_grants",
    };
  }

  return {
    allowedDomains,
    accessLevels,
    source: allowedDomains.length > 0 ? "explicit_grants" : "no_grants",
  };
}

async function resolveCompanyDomainPolicies(
  userId: string,
  memberships: Array<{ companyId: string; role: string }>,
): Promise<Map<string, CompanyDomainPolicy>> {
  const policies = new Map<string, CompanyDomainPolicy>();
  if (memberships.length === 0) return policies;

  const grantRows = await db
    .select({
      companyId: companyMemberDomainGrants.companyId,
      domain: companyMemberDomainGrants.domain,
      accessLevel: companyMemberDomainGrants.accessLevel,
    })
    .from(companyMemberDomainGrants)
    .where(
      and(
        eq(companyMemberDomainGrants.userId, userId),
        eq(companyMemberDomainGrants.status, "active"),
        inArray(
          companyMemberDomainGrants.companyId,
          memberships.map((membership) => membership.companyId),
        ),
      ),
    );

  const grantsByCompanyId = new Map<
    string,
    Array<{ domain: string; accessLevel?: string | null }>
  >();
  for (const grant of grantRows) {
    const grants = grantsByCompanyId.get(grant.companyId) ?? [];
    grants.push({ domain: grant.domain, accessLevel: grant.accessLevel });
    grantsByCompanyId.set(grant.companyId, grants);
  }

  for (const membership of memberships) {
    policies.set(
      membership.companyId,
      resolveCompanyDomainPolicyFromGrants(
        membership.role,
        grantsByCompanyId.get(membership.companyId) ?? [],
      ),
    );
  }

  return policies;
}

export async function resolveDirectCompanyDomainPolicy(
  userId: string,
  companyId: string,
  role: string,
): Promise<CompanyDomainPolicy> {
  const policies = await resolveCompanyDomainPolicies(userId, [{ companyId, role }]);
  return policies.get(companyId) ?? resolveCompanyDomainPolicyFromGrants(role, []);
}

const roleRank: Record<string, number> = {
  viewer: 0,
  member: 1,
  cfo_agent: 2,
  admin: 3,
  owner: 4,
};

function weakestRole(left: string, right: string): string {
  const leftRank = roleRank[left] ?? roleRank.member;
  const rightRank = roleRank[right] ?? roleRank.member;
  return leftRank <= rightRank ? left : right;
}

function mapInheritedAccessPath(
  row: AccessGraphRow,
  allowedDomains: string[],
  domainAccessLevels: CompanyDomainAccessLevelMap,
  allowedConnectorScopes: string[],
): CompanyAccessPathProvenance {
  return {
    accessSource: "inherited",
    role: row.role,
    viaCompanyId: row.viaCompanyId,
    viaCompanyName: row.viaCompanyName,
    viaCompanySlug: row.viaCompanySlug,
    relationshipId: row.relationshipId,
    relationshipType: row.relationshipType,
    allowedDomains,
    domainAccessLevels,
    allowedConnectorScopes,
    pathEdgeIds: row.pathEdgeIds.map(String),
  };
}

/**
 * API-key-only access expansion.
 *
 * Browser/session company access stays direct-membership only. For bearer keys,
 * a key that is scoped to a parent company may also address companies whose
 * `parent_company_id` points at that parent (or, as a legacy fallback during
 * migration, those with `settings.importMetadata.parentCompanyId` set). This
 * deliberately does not create company_members rows.
 */
export async function expandCompanyMembershipsWithImportedChildren(
  memberships: CompanyMembership[],
): Promise<CompanyMembership[]> {
  if (memberships.length === 0) return [];

  const byCompanyId = new Map<string, CompanyMembership>();
  for (const membership of memberships) {
    byCompanyId.set(membership.companyId, membership);
  }

  let frontier = memberships.map((membership) => membership.companyId);
  for (let depth = 0; depth < MAX_IMPORTED_PARENT_EXPANSION_DEPTH && frontier.length > 0; depth += 1) {
    const parentIds = Array.from(new Set(frontier));
    // Prefer the dedicated parent_company_id column; fall back to the legacy
    // jsonb path until the backfill has been verified in production. After
    // the bridge is dropped this becomes a plain reference to companies.parentCompanyId.
    const parentIdExpr = sql<string>`COALESCE(${companies.parentCompanyId}::text, ${companies.settings}->'importMetadata'->>'parentCompanyId')`;

    const childRows = await db
      .select({
        companyId: companies.id,
        companyName: companies.name,
        companySlug: companies.slug,
        companyDbPort: companies.companyDbPort,
        companySettings: companies.settings,
        jurisdiction: companies.jurisdiction,
        entityType: companies.entityType,
        businessType: companies.businessType,
        website: companies.website,
        aliases: companies.aliases,
        reportingCurrency: companies.reportingCurrency,
        parentCompanyId: parentIdExpr,
      })
      .from(companies)
      .where(
        and(
          eq(companies.tenantKind, "company"),
          inArray(parentIdExpr, parentIds),
        ),
      )
      .orderBy(asc(companies.name), asc(companies.createdAt));

    const nextFrontier: string[] = [];
    for (const child of childRows as ImportedChildCompanyRow[]) {
      if (!child.parentCompanyId || byCompanyId.has(child.companyId)) continue;

      const parent = byCompanyId.get(child.parentCompanyId);
      if (!parent) continue;

      byCompanyId.set(child.companyId, {
        companyId: child.companyId,
        companyName: child.companyName,
        companySlug: child.companySlug,
        companyDbPort: child.companyDbPort,
        companySettings: child.companySettings,
        jurisdiction: child.jurisdiction ?? null,
        entityType: child.entityType ?? null,
        businessType: child.businessType ?? null,
        website: child.website ?? null,
        aliases: child.aliases ?? [],
        reportingCurrency: child.reportingCurrency ?? null,
        role: "member",
        joinedAt: parent.joinedAt,
        accessSource: "api_key_parent",
        viaCompanyId: parent.companyId,
        viaCompanyName: parent.companyName,
        viaCompanySlug: parent.companySlug,
        relationshipType: "imported_parent",
        allowedDomains: parent.allowedDomains ?? null,
        domainAccessLevels: parent.domainAccessLevels ?? null,
        allowedConnectorScopes: parent.allowedConnectorScopes ?? null,
        domainAccessSource: "api_key_parent",
      });
      nextFrontier.push(child.companyId);
    }

    frontier = nextFrontier;
  }

  return Array.from(byCompanyId.values());
}

export async function expandCompanyMembershipsWithAccessGraph(
  memberships: CompanyMembership[],
  options?: {
    allowedConnectorScopes?: string[];
    maxDepth?: number;
  },
): Promise<CompanyMembership[]> {
  if (memberships.length === 0) return [];

  const byCompanyId = new Map<string, CompanyMembership>();
  for (const membership of memberships) {
    byCompanyId.set(membership.companyId, {
      ...membership,
      accessSource: membership.accessSource ?? "direct",
    });
  }

  const directIds = new Set(memberships.map((membership) => membership.companyId));
  const rootValues = sql.join(
    memberships.map((membership) => sql`(
      ${membership.companyId}::uuid,
      ${membership.role}::text,
      ${membership.joinedAt.toISOString()}::timestamptz,
      ${membership.allowedDomains ?? null}::text[]
    )`),
    sql`,`,
  );
  const maxDepth = Math.max(1, Math.min(options?.maxDepth ?? MAX_ACCESS_GRAPH_DEPTH, MAX_ACCESS_GRAPH_DEPTH));
  const grantedConnectorScopes = new Set(options?.allowedConnectorScopes ?? []);

  const rows = (await db.execute(sql`
    WITH RECURSIVE roots(root_company_id, root_role, joined_at, root_allowed_domains) AS (
      VALUES ${rootValues}
    ),
    access_paths AS (
      SELECT
        child.id AS "companyId",
        child.name AS "companyName",
        child.slug AS "companySlug",
        child.company_db_port AS "companyDbPort",
        child.settings AS "companySettings",
        child.jurisdiction AS "jurisdiction",
        child.entity_type AS "entityType",
        child.business_type AS "businessType",
        child.website AS "website",
        child.aliases AS "aliases",
        child.reporting_currency AS "reportingCurrency",
        CASE
          WHEN (
            CASE roots.root_role
              WHEN 'viewer' THEN 0
              WHEN 'member' THEN 1
              WHEN 'cfo_agent' THEN 2
              WHEN 'admin' THEN 3
              WHEN 'owner' THEN 4
              ELSE 1
            END
          ) <= (
            CASE edge.inherited_role
              WHEN 'viewer' THEN 0
              WHEN 'member' THEN 1
              WHEN 'cfo_agent' THEN 2
              WHEN 'admin' THEN 3
              WHEN 'owner' THEN 4
              ELSE 1
            END
          )
          THEN roots.root_role
          ELSE edge.inherited_role
        END AS role,
        roots.joined_at AS "joinedAt",
        root_company.id AS "viaCompanyId",
        root_company.name AS "viaCompanyName",
        root_company.slug AS "viaCompanySlug",
        edge.relationship_id AS "relationshipId",
        edge.relationship_type AS "relationshipType",
        CASE
          WHEN roots.root_allowed_domains IS NULL THEN edge.allowed_domains::text[]
          ELSE ARRAY(
            SELECT unnest(roots.root_allowed_domains)
            INTERSECT
            SELECT unnest(edge.allowed_domains)
          )::text[]
        END AS "allowedDomains",
        edge.allowed_connector_scopes::text[] AS "allowedConnectorScopes",
        ARRAY[edge.id]::uuid[] AS "pathEdgeIds",
        ARRAY[roots.root_company_id, child.id]::uuid[] AS path_company_ids,
        1 AS depth
      FROM roots
      JOIN companies root_company ON root_company.id = roots.root_company_id
      JOIN company_access_edges edge
        ON edge.parent_company_id = roots.root_company_id
       AND edge.status = 'active'
      JOIN companies child
        ON child.id = edge.child_company_id
       AND child.tenant_kind = 'company'
      WHERE cardinality(
        CASE
          WHEN roots.root_allowed_domains IS NULL THEN edge.allowed_domains::text[]
          ELSE ARRAY(
            SELECT unnest(roots.root_allowed_domains)
            INTERSECT
            SELECT unnest(edge.allowed_domains)
          )::text[]
        END
      ) > 0

      UNION ALL

      SELECT
        child.id AS "companyId",
        child.name AS "companyName",
        child.slug AS "companySlug",
        child.company_db_port AS "companyDbPort",
        child.settings AS "companySettings",
        child.jurisdiction AS "jurisdiction",
        child.entity_type AS "entityType",
        child.business_type AS "businessType",
        child.website AS "website",
        child.aliases AS "aliases",
        child.reporting_currency AS "reportingCurrency",
        CASE
          WHEN (
            CASE access_paths.role
              WHEN 'viewer' THEN 0
              WHEN 'member' THEN 1
              WHEN 'cfo_agent' THEN 2
              WHEN 'admin' THEN 3
              WHEN 'owner' THEN 4
              ELSE 1
            END
          ) <= (
            CASE edge.inherited_role
              WHEN 'viewer' THEN 0
              WHEN 'member' THEN 1
              WHEN 'cfo_agent' THEN 2
              WHEN 'admin' THEN 3
              WHEN 'owner' THEN 4
              ELSE 1
            END
          )
          THEN access_paths.role
          ELSE edge.inherited_role
        END AS role,
        access_paths."joinedAt" AS "joinedAt",
        access_paths."viaCompanyId" AS "viaCompanyId",
        access_paths."viaCompanyName" AS "viaCompanyName",
        access_paths."viaCompanySlug" AS "viaCompanySlug",
        edge.relationship_id AS "relationshipId",
        edge.relationship_type AS "relationshipType",
        ARRAY(
          SELECT unnest(access_paths."allowedDomains")
          INTERSECT
          SELECT unnest(edge.allowed_domains)
        )::text[] AS "allowedDomains",
        ARRAY(
          SELECT unnest(access_paths."allowedConnectorScopes")
          INTERSECT
          SELECT unnest(edge.allowed_connector_scopes)
        )::text[] AS "allowedConnectorScopes",
        access_paths."pathEdgeIds" || edge.id AS "pathEdgeIds",
        access_paths.path_company_ids || child.id AS path_company_ids,
        access_paths.depth + 1 AS depth
      FROM access_paths
      JOIN company_access_edges edge
        ON edge.parent_company_id = access_paths."companyId"
       AND edge.status = 'active'
      JOIN companies child
        ON child.id = edge.child_company_id
       AND child.tenant_kind = 'company'
      WHERE access_paths.depth < ${maxDepth}
        AND NOT child.id = ANY(access_paths.path_company_ids)
        AND cardinality(ARRAY(
          SELECT unnest(access_paths."allowedDomains")
          INTERSECT
          SELECT unnest(edge.allowed_domains)
        )) > 0
    )
    SELECT
      "companyId",
      "companyName",
      "companySlug",
      "companyDbPort",
      "companySettings",
      "jurisdiction",
      "entityType",
      "businessType",
      "website",
      "aliases",
      "reportingCurrency",
      role,
      "joinedAt",
      "viaCompanyId",
      "viaCompanyName",
      "viaCompanySlug",
      "relationshipId",
      "relationshipType",
      "allowedDomains",
      "allowedConnectorScopes",
      "pathEdgeIds",
      depth
    FROM access_paths
    ORDER BY depth ASC, "companyName" ASC
  `)) as unknown as AccessGraphRow[];

  for (const row of rows) {
    const allowedConnectorScopes = uniqueSorted(
      row.allowedConnectorScopes.filter(
        (scope) => grantedConnectorScopes.size === 0 || grantedConnectorScopes.has(scope),
      ),
    );
    const allowedDomains = uniqueSorted(row.allowedDomains);
    if (allowedDomains.length === 0) continue;
    const inheritedDomainAccessPolicy = deriveInheritedDomainAccessPolicy(
      byCompanyId.get(row.viaCompanyId),
      allowedDomains,
    );
    if (!inheritedDomainAccessPolicy) continue;

    if (directIds.has(row.companyId)) {
      const existing = byCompanyId.get(row.companyId);
      if (!existing) continue;

      byCompanyId.set(row.companyId, {
        ...existing,
        inheritedAccessPaths: [
          ...(existing.inheritedAccessPaths ?? []),
          mapInheritedAccessPath(
            row,
            inheritedDomainAccessPolicy.allowedDomains,
            inheritedDomainAccessPolicy.accessLevels,
            allowedConnectorScopes,
          ),
        ],
      });
      continue;
    }

    const existing = byCompanyId.get(row.companyId);
    if (existing?.accessSource === "direct") continue;

    if (existing) {
      byCompanyId.set(row.companyId, {
        ...existing,
        role: weakestRole(existing.role, row.role),
        allowedDomains: uniqueSorted([
          ...(existing.allowedDomains ?? []),
          ...inheritedDomainAccessPolicy.allowedDomains,
        ]),
        domainAccessLevels: mergeDomainAccessLevelMaps(
          existing.domainAccessLevels,
          inheritedDomainAccessPolicy.accessLevels,
        ),
        allowedConnectorScopes: uniqueSorted([
          ...(existing.allowedConnectorScopes ?? []),
          ...allowedConnectorScopes,
        ]),
        pathEdgeIds: uniqueSorted([
          ...(existing.pathEdgeIds ?? []),
          ...row.pathEdgeIds.map(String),
        ]),
      });
      continue;
    }

    byCompanyId.set(row.companyId, {
      companyId: row.companyId,
      companyName: row.companyName,
      companySlug: row.companySlug,
      companyDbPort: row.companyDbPort,
      companySettings: row.companySettings,
      jurisdiction: row.jurisdiction ?? null,
      entityType: row.entityType ?? null,
      businessType: row.businessType ?? null,
      website: row.website ?? null,
      aliases: row.aliases ?? [],
      reportingCurrency: row.reportingCurrency ?? null,
      role: row.role,
      joinedAt: row.joinedAt,
      accessSource: "inherited",
      viaCompanyId: row.viaCompanyId,
      viaCompanyName: row.viaCompanyName,
      viaCompanySlug: row.viaCompanySlug,
      relationshipId: row.relationshipId,
      relationshipType: row.relationshipType,
      allowedDomains: inheritedDomainAccessPolicy.allowedDomains,
      domainAccessLevels: inheritedDomainAccessPolicy.accessLevels,
      allowedConnectorScopes,
      domainAccessSource: "inherited",
      pathEdgeIds: row.pathEdgeIds.map(String),
    });
  }

  return Array.from(byCompanyId.values());
}

async function requireMembership(
  userId: string,
  tenantId: string,
  tenantKind?: TenantKind,
): Promise<{ tenantId: string; role: string }> {
  const rows = await db
    .select({ tenantId: companyMembers.companyId, role: companyMembers.role })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(
      tenantKind
        ? and(
          eq(companyMembers.userId, userId),
          eq(companyMembers.companyId, tenantId),
          eq(companies.tenantKind, tenantKind),
        )
        : and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, tenantId)),
    )
    .limit(1);

  if (!rows.length) throw new UnauthorizedError();
  return { tenantId: rows[0].tenantId, role: rows[0].role };
}

export async function requireTenantMembership(
  userId: string,
  tenantId: string,
): Promise<{ tenantId: string; role: string }> {
  return requireMembership(userId, tenantId);
}

/**
 * Verifies that a specific user is a member of a specific company.
 * Unlike requireCompanyWithRole() which picks the first company,
 * this verifies membership for an explicitly provided companyId.
 */
export async function requireCompanyMembership(
  userId: string,
  companyId: string,
): Promise<{ companyId: string; role: string }> {
  const membership = await requireMembership(userId, companyId, "company");
  return { companyId: membership.tenantId, role: membership.role };
}

async function resolveTenantWithRole(
  userId: string,
  preferredTenantId?: string,
  tenantKind?: TenantKind,
): Promise<{ tenantId: string; role: string }> {
  if (preferredTenantId) {
    const exact = await db
      .select({ tenantId: companyMembers.companyId, role: companyMembers.role })
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .where(
        tenantKind
          ? and(
            eq(companyMembers.userId, userId),
            eq(companyMembers.companyId, preferredTenantId),
            eq(companies.tenantKind, tenantKind),
          )
          : and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, preferredTenantId)),
      )
      .limit(1);

    if (!exact.length) throw new UnauthorizedError();
    return { tenantId: exact[0].tenantId, role: exact[0].role };
  }

  const memberships = await selectTenantMemberships(userId, tenantKind);
  if (!memberships.length) throw new NoCompanyError();

  return {
    tenantId: memberships[0].tenantId,
    role: memberships[0].role,
  };
}

export async function requireTenantWithRole(
  userId: string,
  preferredTenantId?: string,
): Promise<{ tenantId: string; role: string }> {
  return resolveTenantWithRole(userId, preferredTenantId);
}

export async function getPersonalTenantMembership(
  userId: string,
): Promise<TenantMembership | null> {
  const memberships = await db
    .select({
      tenantId: companies.id,
      tenantName: companies.name,
      tenantSlug: companies.slug,
      tenantKind: companies.tenantKind,
      schemaPack: companies.schemaPack,
      tenantDbPort: companies.companyDbPort,
      tenantSettings: companies.settings,
      role: companyMembers.role,
      joinedAt: companyMembers.createdAt,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(
      and(
        eq(companyMembers.userId, userId),
        eq(companies.tenantKind, "person"),
        eq(companies.personalForUserId, userId),
      ),
    )
    .limit(1);

  return memberships[0] ? mapTenantMembership(memberships[0]) : null;
}

export async function getCompanyForUser(userId: string): Promise<string | null> {
  const membership = await db
    .select({ companyId: companyMembers.companyId })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(and(eq(companyMembers.userId, userId), eq(companies.tenantKind, "company")))
    .orderBy(asc(companyMembers.createdAt), asc(companies.createdAt))
    .limit(1);

  if (!membership.length) return null;
  return membership[0].companyId;
}

export async function requireCompany(userId: string): Promise<string> {
  const companyId = await getCompanyForUser(userId);
  if (!companyId) throw new NoCompanyError();
  return companyId;
}

export async function requireCompanyWithRole(
  userId: string,
  preferredCompanyId?: string,
): Promise<{ companyId: string; role: string }> {
  const membership = await resolveTenantWithRole(userId, preferredCompanyId, "company");
  return { companyId: membership.tenantId, role: membership.role };
}

export async function requireCompanyBySlug(
  userId: string,
  slug: string,
  requiredRole?: string,
): Promise<{ companyId: string; role: string; companyDbPort: number }> {
  const conditions = [
    eq(companies.slug, slug),
    eq(companies.tenantKind, "company"),
    eq(companyMembers.userId, userId),
  ];
  if (requiredRole) {
    conditions.push(eq(companyMembers.role, requiredRole));
  }

  const rows = await db
    .select({
      companyId: companies.id,
      role: companyMembers.role,
      companyDbPort: companies.companyDbPort,
    })
    .from(companies)
    .innerJoin(companyMembers, eq(companyMembers.companyId, companies.id))
    .where(and(...conditions))
    .limit(1);

  if (!rows.length) {
    if (requiredRole) throw new UnauthorizedError();
    throw new NoCompanyError();
  }

  return {
    companyId: rows[0].companyId,
    role: rows[0].role,
    companyDbPort: rows[0].companyDbPort,
  };
}
