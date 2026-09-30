import { pgTable, uuid, text, timestamp, jsonb, integer, numeric, boolean, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ApiKeyScope } from "@/lib/api-key-scopes";
import type { ApiKeyCompanyScopeMode } from "@/lib/api-key-company-scope";
import type { ApiKeyAccessPolicyVersion } from "@/lib/api-key-access-policy";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  tenantKind: text("tenant_kind").default("company").notNull(),
  schemaPack: text("schema_pack").default("company").notNull(),
  personalForUserId: text("personal_for_user_id"),
  jurisdiction: text("jurisdiction"),
  entityType: text("entity_type"),
  businessType: text("business_type"),
  website: text("website"),
  reportingCurrency: text("reporting_currency").default("USD").notNull(),
  settings: jsonb("settings").default({}).$type<Record<string, unknown>>(),
  parentCompanyId: uuid("parent_company_id"),
  aliases: text("aliases").array().default(sql`ARRAY[]::text[]`).notNull(),
  /** REST port for this tenant's Company-DB process (default 3100, write-queue on port+1) */
  companyDbPort: integer("company_db_port").default(3100).notNull(),
  /**
   * Tracks whether the per-tenant company-db git repo and PM2 daemon have been
   * spun up. 'active' = fully provisioned (default for backfilled rows).
   * 'pending' = DB row exists but no PM2 process / git repo yet (community-tier
   * lazy provisioning — promoted to 'active' on first chat or upload).
   * 'failed' = a provisioning attempt errored; safe to retry.
   */
  provisioningStatus: text("provisioning_status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("companies_tenant_kind_idx").on(table.tenantKind),
  uniqueIndex("companies_personal_for_user_idx").on(table.personalForUserId),
  index("companies_parent_company_id_idx").on(table.parentCompanyId),
  index("companies_provisioning_status_idx").on(table.provisioningStatus),
]);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const landingLeads = pgTable("landing_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  intent: text("intent").notNull(),
  plan: text("plan"),
  email: text("email").notNull(),
  name: text("name"),
  companyName: text("company_name"),
  message: text("message"),
  locale: text("locale").notNull(),
  path: text("path"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("landing_leads_created_at_idx").on(table.createdAt),
  index("landing_leads_intent_idx").on(table.intent),
  index("landing_leads_email_idx").on(table.email),
]);

// Better Auth core tables — user, session, account, verification
// BetterAuth generates its own non-UUID IDs, so these use text primary keys.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  /**
   * 'managed' = full-provisioning, server-side OPENAI key (existing default).
   * 'community' = lazy-provisioned tenant + must bring their own OpenAI/Codex key.
   * All existing rows backfill to 'managed' via the column default.
   */
  tier: text("tier").default("managed").notNull(),
  /**
   * Resume pointer for chat-first onboarding. NULL when the user is not
   * mid-onboarding. Cleared after onboarding_complete_and_handoff. Cross-
   * device deep-link returns to this thread instead of creating a new one,
   * which fixes the two-tabs-same-user case. Per Architect review §8.
   */
  currentOnboardingThreadId: uuid("current_onboarding_thread_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Signup gate. Every new sign-up must present a valid invite code.
 * The code carries the tier ('managed' | 'community') the new user inherits.
 * `max_uses = NULL` means unlimited (used for shared managed invite links);
 * single-use friend invites have `max_uses = 1`.
 */
export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  tier: text("tier").notNull(),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").default(0).notNull(),
  note: text("note"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  index("invite_codes_tier_idx").on(table.tier),
]);

/**
 * Per-user encrypted API key storage. Used for tier='community' BYOK.
 * `provider`: 'openai' (chat + Whisper) or 'codex' (codex-worker auth token).
 * `keyEncrypted`: encrypted with the same scheme as connections.credentialsEncrypted.
 */
export const userApiKeys = pgTable("user_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  keyEncrypted: text("key_encrypted").notNull(),
  label: text("label"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("user_api_keys_user_provider_idx").on(table.userId, table.provider),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // DATA-5: hot-path sign-in lookups and cascade deletes
  index("sessions_user_id_idx").on(table.userId),
]);

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // DATA-5: hot-path sign-in lookups and cascade deletes
  index("accounts_user_id_idx").on(table.userId),
]);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // DATA-5: every sign-in / email verification lookup hits this column
  index("verifications_identifier_idx").on(table.identifier),
]);

export const oauthApplications = pgTable("oauth_applications", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  metadata: text("metadata"),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  redirectUrls: text("redirect_urls").notNull(),
  type: text("type").notNull(),
  disabled: boolean("disabled").default(false).notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("oauth_applications_user_id_idx").on(table.userId),
]);

export const oauthAccessTokens = pgTable("oauth_access_tokens", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").notNull().unique(),
  refreshToken: text("refresh_token").notNull().unique(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }).notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthApplications.clientId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  scopes: text("scopes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("oauth_access_tokens_client_id_idx").on(table.clientId),
  index("oauth_access_tokens_user_id_idx").on(table.userId),
]);

export const oauthConsents = pgTable("oauth_consents", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthApplications.clientId, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scopes: text("scopes").notNull(),
  consentGiven: boolean("consent_given").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("oauth_consents_client_id_idx").on(table.clientId),
  index("oauth_consents_user_id_idx").on(table.userId),
]);

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const companyMembers = pgTable("company_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_members_company_user_idx").on(table.companyId, table.userId),
]);

export const companyMemberDomainGrants = pgTable("company_member_domain_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  accessLevel: text("access_level").notNull().default("read"),
  status: text("status").notNull().default("active"),
  source: text("source").notNull().default("manual"),
  approvedByUserId: text("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_member_domain_grants_active_unique_idx")
    .on(table.companyId, table.userId, table.domain)
    .where(sql`${table.status} = 'active'`),
  index("company_member_domain_grants_company_user_idx").on(table.companyId, table.userId),
  index("company_member_domain_grants_status_idx").on(table.status),
  check(
    "company_member_domain_grants_domain_check",
    sql`${table.domain} = '*' OR ${table.domain} ~ '^[a-z0-9][a-z0-9-]*$'`,
  ),
  check(
    "company_member_domain_grants_access_level_check",
    sql`${table.accessLevel} in ('metadata','read','file','write','admin')`,
  ),
  check(
    "company_member_domain_grants_status_check",
    sql`${table.status} in ('active','revoked')`,
  ),
]);

export const userAdminRoles = pgTable("user_admin_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  scopeCompanyId: uuid("scope_company_id").references(() => companies.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  grantedByUserId: text("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("user_admin_roles_active_unique_idx")
    .on(table.userId, table.role, table.scopeCompanyId)
    .where(sql`${table.status} = 'active'`),
  index("user_admin_roles_user_status_idx").on(table.userId, table.status),
  index("user_admin_roles_scope_status_idx").on(table.scopeCompanyId, table.status),
  check(
    "user_admin_roles_role_check",
    sql`${table.role} in ('platform_admin','organization_structure_admin')`,
  ),
  check(
    "user_admin_roles_status_check",
    sql`${table.status} in ('active','revoked')`,
  ),
]);

export const founderAdminOperatingNotes = pgTable("founder_admin_operating_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  objectId: text("object_id").notNull(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  noteKind: text("note_kind").notNull().default("operating_context"),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: text("key_version").notNull(),
  sourceRefs: jsonb("source_refs").notNull().default(sql`'[]'::jsonb`).$type<Array<Record<string, unknown>>>(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: text("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("founder_admin_operating_notes_global_unique_idx")
    .on(table.objectId, table.noteKind)
    .where(sql`${table.companyId} is null`),
  uniqueIndex("founder_admin_operating_notes_company_unique_idx")
    .on(table.objectId, table.companyId, table.noteKind)
    .where(sql`${table.companyId} is not null`),
  index("founder_admin_operating_notes_object_idx").on(table.objectId),
  index("founder_admin_operating_notes_company_idx").on(table.companyId),
  index("founder_admin_operating_notes_kind_idx").on(table.noteKind),
]);

export const companyAccessEdges = pgTable("company_access_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentCompanyId: uuid("parent_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  childCompanyId: uuid("child_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  relationshipId: text("relationship_id"),
  relationshipType: text("relationship_type").notNull(),
  inheritedRole: text("inherited_role").notNull().default("member"),
  allowedDomains: text("allowed_domains").array().notNull(),
  allowedConnectorScopes: text("allowed_connector_scopes").array().notNull().default(sql`ARRAY[]::text[]`),
  status: text("status").notNull().default("draft"),
  source: text("source").notNull().default("structure_editor"),
  approvedByUserId: text("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_access_edges_active_unique_idx")
    .on(table.parentCompanyId, table.childCompanyId, table.relationshipType)
    .where(sql`${table.status} = 'active'`),
  index("company_access_edges_parent_idx").on(table.parentCompanyId),
  index("company_access_edges_child_idx").on(table.childCompanyId),
  index("company_access_edges_status_idx").on(table.status),
  check(
    "company_access_edges_status_check",
    sql`${table.status} in ('draft','active','revoked')`,
  ),
  check(
    "company_access_edges_role_check",
    sql`${table.inheritedRole} in ('viewer','member','admin','cfo_agent')`,
  ),
  check(
    "company_access_edges_not_self_check",
    sql`${table.parentCompanyId} <> ${table.childCompanyId}`,
  ),
  check(
    "company_access_edges_active_domains_check",
    sql`${table.status} <> 'active' OR cardinality(${table.allowedDomains}) > 0`,
  ),
]);

export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("active"),
  credentialsEncrypted: text("credentials_encrypted").notNull(),
  scopes: text("scopes").array(),
  externalAccountId: text("external_account_id"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  errorCount: integer("error_count").default(0).notNull(),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("connections_company_provider_idx").on(table.companyId, table.provider),
  index("connections_company_status_idx").on(table.companyId, table.status),
]);

export const rawEvents = pgTable("raw_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  connectionId: uuid("connection_id").references(() => connections.id),
  sourceEventId: text("source_event_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  rawPayload: jsonb("raw_payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingVer: integer("processing_ver").default(1).notNull(),
}, (table) => [
  uniqueIndex("raw_events_idempotency_idx").on(table.companyId, table.idempotencyKey),
]);

/**
 * Transactional outbox for Inngest events. Writers in HTTP routes
 * insert rows here in the same DB transaction as their primary state
 * (so the event is durable even if `inngest.send()` would fail). A
 * separate Inngest cron drains pending rows. Eliminates the "doc
 * stuck because send() blew up silently" failure mode that the
 * retry-stuck-documents cron used to compensate for.
 *
 * See docs/architecture/document-pipeline-stability.md (Tier A3).
 */
export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventName: text("event_name").notNull(),
  eventData: jsonb("event_data").notNull().$type<Record<string, unknown>>(),
  // pending | sent | failed
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [
  index("outbox_events_status_created_idx").on(table.status, table.createdAt),
]);

export const communicationMessages = pgTable("communication_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerMessageId: text("provider_message_id").notNull(),
  providerChatId: text("provider_chat_id").notNull(),
  providerThreadId: text("provider_thread_id").notNull(),
  subject: text("subject"),
  senderName: text("sender_name"),
  senderAddress: text("sender_address"),
  senderId: text("sender_id"),
  participantAddresses: jsonb("participant_addresses").notNull().default([]).$type<string[]>(),
  attachmentRefs: jsonb("attachment_refs").notNull().default([]).$type<Array<Record<string, unknown>>>(),
  content: text("content"),
  rawPayload: jsonb("raw_payload").notNull().$type<Record<string, unknown>>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  processingStatus: text("processing_status").notNull().default("pending"),
  synthesisBatchId: text("synthesis_batch_id"),
  synthesisVersion: integer("synthesis_version").notNull().default(1),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("communication_messages_dedup_idx").on(
    table.companyId,
    table.provider,
    table.providerChatId,
    table.providerMessageId,
  ),
  index("communication_messages_company_thread_idx").on(
    table.companyId,
    table.provider,
    table.providerThreadId,
    table.receivedAt,
  ),
  index("communication_messages_processing_idx").on(table.companyId, table.processingStatus, table.receivedAt),
]);

export const canonicalTxns = pgTable("canonical_txns", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  rawEventId: uuid("raw_event_id").notNull().references(() => rawEvents.id),
  connectionId: uuid("connection_id").references(() => connections.id),
  date: timestamp("date", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  amountUsd: numeric("amount_usd", { precision: 15, scale: 2 }).notNull(),
  fxRate: numeric("fx_rate", { precision: 12, scale: 6 }),
  description: text("description"),
  merchantName: text("merchant_name"),
  merchantMcc: text("merchant_mcc"),
  sourceRef: text("source_ref"),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("canonical_txns_company_date_idx").on(table.companyId, table.date),
  index("canonical_txns_company_connection_idx").on(table.companyId, table.connectionId),
  index("canonical_txns_source_ref_idx").on(table.sourceRef, table.connectionId, table.companyId),
]);

export const reconciledTxns = pgTable("reconciled_txns", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  canonicalTxnId: uuid("canonical_txn_id").notNull().references(() => canonicalTxns.id),
  category: text("category"),
  categoryConfidence: numeric("category_confidence", { precision: 5, scale: 2 }),
  categorizedBy: text("categorized_by"),
  categoryReasoning: text("category_reasoning"),
  dedupGroupId: uuid("dedup_group_id"),
  dedupStatus: text("dedup_status").default("unique"),
  isReviewed: boolean("is_reviewed").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("reconciled_txns_canonical_txn_id_idx").on(table.canonicalTxnId),
  index("reconciled_txns_company_category_idx").on(table.companyId, table.category),
]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  storageUrl: text("storage_url").notNull(),
  sha256: text("sha256").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("processing"),
  // Type-safe lifecycle stage. Dual-written alongside ocr_result.*.stage
  // JSONB blobs during the Tier A1 transition. Once readers migrate,
  // ocr_result stage fields become dead and can be removed.
  // Allowed values: received | dispatched | parsing | parsed | failed
  // See docs/architecture/document-pipeline-stability.md §7-A1.
  processingStage: text("processing_stage").notNull().default("received"),
  extractedTxnCount: integer("extracted_txn_count").default(0),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
  ocrResult: jsonb("ocr_result").$type<Record<string, unknown>>(),
  error: text("error"),
  documentType: text("document_type"),
  reportingPeriod: text("reporting_period"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("documents_company_stage_idx").on(table.companyId, table.processingStage),
  index("documents_stage_created_idx").on(table.processingStage, table.createdAt),
]);

export const merchantRules = pgTable("merchant_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id),
  merchantPattern: text("merchant_pattern").notNull(),
  category: text("category").notNull(),
  source: text("source").notNull().default("system"),
  matchCount: integer("match_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // DATA-4: company-deletion and audit-query indexes; avoids seq-scan inside lock
  index("audit_log_company_entity_idx").on(table.companyId, table.entityType, table.entityId),
  index("audit_log_action_created_at_idx").on(table.action, table.createdAt),
  index("audit_log_created_at_idx").on(table.createdAt),
]);

export const fxRates = pgTable("fx_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  quoteCurrency: text("quote_currency").notNull(),
  /**
   * Stored as `numeric(24, 12)` — wide enough to store both:
   *   - hyperinflation fiat rates (1 USD = 6 000 000+ LBP/VES/ZWL crisis spikes),
   *   - and very fractional crypto rates (USD/BTC ≈ 0.0000087 etc.).
   * Earlier `numeric(12, 6)` capped the integer part at 999 999 and produced
   * "numeric field overflow" inserts when fetchers occasionally returned a
   * crisis-level rate (see prod 2026-04-23 nextjs-error.log spikes).
   */
  rate: numeric("rate", { precision: 24, scale: 12 }).notNull(),
  source: text("source").notNull(),
  rateDate: timestamp("rate_date", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("fx_rates_currency_date_idx").on(table.baseCurrency, table.quoteCurrency, table.rateDate),
  uniqueIndex("fx_rates_dedup_idx").on(table.baseCurrency, table.quoteCurrency, table.rateDate, table.source),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  type: text("type").notNull(), // "sync_amber" | "sync_red" | "auth_expiry" | "sync_recovered"
  severity: text("severity").notNull(), // "warning" | "critical" | "info"
  title: text("title").notNull(),
  message: text("message").notNull(),
  connectionId: uuid("connection_id").references(() => connections.id),
  isRead: boolean("is_read").default(false).notNull(),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  followUpSentAt: timestamp("follow_up_sent_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("notifications_company_unread_idx").on(table.companyId, table.isRead),
  index("notifications_connection_type_idx").on(table.connectionId, table.type),
]);

// ── Pipeline tables (Company-DB connector pipeline) ──────────────────

export const stagingRecords = pgTable("staging_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  companySlug: text("company_slug").notNull(),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().default("pending"), // pending | processing | committed | failed
  retries: integer("retries").default(0).notNull(),
  maxRetries: integer("max_retries").default(5).notNull(),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  commitSha: text("commit_sha"),
  entityIds: text("entity_ids").array(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("staging_records_dedup_idx").on(table.companySlug, table.source, table.externalId),
  index("staging_records_pending_idx").on(table.companySlug, table.status),
]);

export const pendingSignals = pgTable("pending_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key").notNull(),
  signalType: text("signal_type").notNull(),
  targetDomain: text("target_domain").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  sourceProvider: text("source_provider"),
  sourceThreadId: text("source_thread_id"),
  sourceLabel: text("source_label"),
  communicationMessageIds: text("communication_message_ids").array(),
  structuredData: jsonb("structured_data").notNull().default({}).$type<Record<string, unknown>>(),
  proposedFilePath: text("proposed_file_path").notNull(),
  proposedFrontmatter: jsonb("proposed_frontmatter").notNull().default({}).$type<Record<string, unknown>>(),
  proposedBody: text("proposed_body").notNull(),
  status: text("status").notNull().default("pending"),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  commitSha: text("commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("pending_signals_dedup_idx").on(table.companyId, table.dedupKey),
  index("pending_signals_company_status_idx").on(table.companyId, table.status, table.createdAt),
  index("pending_signals_company_domain_idx").on(table.companyId, table.targetDomain, table.createdAt),
]);

export const routineTemplates = pgTable("routine_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateKey: text("template_key").notNull(),
  title: text("title").notNull(),
  domain: text("domain").notNull(),
  defaultJurisdiction: text("default_jurisdiction"),
  defaultTopic: text("default_topic"),
  defaultSources: jsonb("default_sources").notNull().default(sql`'[]'::jsonb`).$type<Array<Record<string, unknown>>>(),
  defaultSchedulePolicy: jsonb("default_schedule_policy").notNull().default({}).$type<Record<string, unknown>>(),
  defaultReviewPolicy: jsonb("default_review_policy").notNull().default({}).$type<Record<string, unknown>>(),
  defaultDigestPolicy: jsonb("default_digest_policy").notNull().default({}).$type<Record<string, unknown>>(),
  requiredPermissions: text("required_permissions").array().notNull().default(sql`ARRAY[]::text[]`),
  requiredInputs: jsonb("required_inputs").notNull().default(sql`'[]'::jsonb`).$type<Array<Record<string, unknown>>>(),
  riskLevel: text("risk_level").notNull().default("medium"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("routine_templates_template_key_idx").on(table.templateKey),
  index("routine_templates_domain_status_idx").on(table.domain, table.status),
  check(
    "routine_templates_risk_level_check",
    sql`${table.riskLevel} in ('low','medium','high')`,
  ),
  check(
    "routine_templates_status_check",
    sql`${table.status} in ('draft','active','retired')`,
  ),
]);

export const routineDefinitions = pgTable("routine_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  scopeType: text("scope_type").notNull().default("company"),
  scopeId: text("scope_id"),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  templateKey: text("template_key").notNull(),
  domain: text("domain").notNull(),
  jurisdiction: text("jurisdiction"),
  topic: text("topic"),
  status: text("status").notNull().default("draft"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  createdFrom: text("created_from").notNull().default("template"),
  schedulePolicy: jsonb("schedule_policy").notNull().default({}).$type<Record<string, unknown>>(),
  sourcePolicy: jsonb("source_policy").notNull().default({}).$type<Record<string, unknown>>(),
  reviewPolicy: jsonb("review_policy").notNull().default({}).$type<Record<string, unknown>>(),
  digestPolicy: jsonb("digest_policy").notNull().default({}).$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("routine_definitions_company_slug_idx").on(table.companyId, table.slug),
  index("routine_definitions_company_status_idx").on(table.companyId, table.status, table.updatedAt),
  index("routine_definitions_company_template_idx").on(table.companyId, table.templateKey),
  check(
    "routine_definitions_scope_type_check",
    sql`${table.scopeType} in ('company','project','operating_object','personal_project')`,
  ),
  check(
    "routine_definitions_status_check",
    sql`${table.status} in ('draft','active','paused','archived')`,
  ),
  check(
    "routine_definitions_created_from_check",
    sql`${table.createdFrom} in ('template','chat_draft','api','import')`,
  ),
]);

export const routineSources = pgTable("routine_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  routineId: uuid("routine_id").notNull().references(() => routineDefinitions.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  sourceType: text("source_type").notNull(),
  authority: text("authority").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  topicTags: text("topic_tags").array().notNull().default(sql`ARRAY[]::text[]`),
  fetchMode: text("fetch_mode").notNull(),
  checkFrequency: text("check_frequency").notNull(),
  stalenessRisk: text("staleness_risk").notNull(),
  trustTier: text("trust_tier").notNull(),
  status: text("status").notNull().default("active"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
  lastContentHash: text("last_content_hash"),
  lastError: text("last_error"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("routine_sources_routine_key_idx").on(table.routineId, table.sourceKey),
  index("routine_sources_company_status_idx").on(table.companyId, table.status),
  index("routine_sources_routine_status_idx").on(table.routineId, table.status),
  check(
    "routine_sources_type_check",
    sql`${table.sourceType} in ('primary_law','regulation','official_guidance','official_news','secondary_commentary','manual_seed')`,
  ),
  check(
    "routine_sources_fetch_mode_check",
    sql`${table.fetchMode} in ('http_html','http_pdf','rss','sitemap','manual')`,
  ),
  check(
    "routine_sources_frequency_check",
    sql`${table.checkFrequency} in ('daily','weekly','monthly','manual')`,
  ),
  check(
    "routine_sources_risk_check",
    sql`${table.stalenessRisk} in ('high','medium','low')`,
  ),
  check(
    "routine_sources_trust_tier_check",
    sql`${table.trustTier} in ('primary','official','secondary')`,
  ),
  check(
    "routine_sources_status_check",
    sql`${table.status} in ('active','paused','broken','retired')`,
  ),
]);

export const routineRuns = pgTable("routine_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  routineId: uuid("routine_id").notNull().references(() => routineDefinitions.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull().default("manual"),
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }),
  status: text("status").notNull().default("queued"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  stats: jsonb("stats").notNull().default({}).$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("routine_runs_routine_created_idx").on(table.routineId, table.createdAt),
  index("routine_runs_company_status_idx").on(table.companyId, table.status, table.createdAt),
  uniqueIndex("routine_runs_scheduled_window_unique_idx")
    .on(table.companyId, table.routineId, table.windowStart, table.windowEnd)
    .where(sql`${table.trigger} in ('scheduled','backfill') and ${table.windowStart} is not null and ${table.windowEnd} is not null`),
  check(
    "routine_runs_trigger_check",
    sql`${table.trigger} in ('manual','scheduled','backfill','test')`,
  ),
  check(
    "routine_runs_status_check",
    sql`${table.status} in ('queued','running','completed','completed_with_errors','failed','cancelled')`,
  ),
]);

export const routineObservations = pgTable("routine_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  routineRunId: uuid("routine_run_id").notNull().references(() => routineRuns.id, { onDelete: "cascade" }),
  routineSourceId: uuid("routine_source_id").notNull().references(() => routineSources.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceEventId: text("source_event_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  contentHash: text("content_hash"),
  canonicalUrl: text("canonical_url").notNull(),
  sourceTitle: text("source_title"),
  sourceDate: timestamp("source_date", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  rawEventId: uuid("raw_event_id").references(() => rawEvents.id, { onDelete: "set null" }),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  snapshotRef: text("snapshot_ref"),
  changeKind: text("change_kind").notNull(),
  status: text("status").notNull().default("observed"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("routine_observations_idempotency_idx").on(table.companyId, table.idempotencyKey),
  index("routine_observations_run_idx").on(table.routineRunId, table.createdAt),
  index("routine_observations_source_idx").on(table.routineSourceId, table.createdAt),
  check(
    "routine_observations_change_kind_check",
    sql`${table.changeKind} in ('new','changed','unchanged','gone','error')`,
  ),
  check(
    "routine_observations_status_check",
    sql`${table.status} in ('observed','normalized','candidate_created','ignored','failed')`,
  ),
]);

export const routineUpdateCandidates = pgTable("routine_update_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  routineId: uuid("routine_id").notNull().references(() => routineDefinitions.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key").notNull(),
  targetDomain: text("target_domain").notNull().default("legal"),
  targetPath: text("target_path").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  sourceDate: timestamp("source_date", { withTimezone: true }),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
  reviewStatus: text("review_status").notNull().default("pending"),
  legalStatus: text("legal_status").notNull().default("unclear"),
  sourceUrls: text("source_urls").array().notNull().default(sql`ARRAY[]::text[]`),
  observationIds: text("observation_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  proposedFrontmatter: jsonb("proposed_frontmatter").notNull().default({}).$type<Record<string, unknown>>(),
  proposedBody: text("proposed_body").notNull(),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReason: text("review_reason"),
  commitSha: text("commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("routine_update_candidates_dedup_idx").on(table.companyId, table.dedupKey),
  index("routine_update_candidates_routine_status_idx").on(table.routineId, table.reviewStatus, table.createdAt),
  index("routine_update_candidates_company_status_idx").on(table.companyId, table.reviewStatus, table.createdAt),
  check(
    "routine_update_candidates_review_status_check",
    sql`${table.reviewStatus} in ('pending','approving','approved','rejected','superseded')`,
  ),
  check(
    "routine_update_candidates_legal_status_check",
    sql`${table.legalStatus} in ('active','possibly_superseded','unclear','commentary_only')`,
  ),
]);

export const routineDigestArtifacts = pgTable("routine_digest_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  routineId: uuid("routine_id").notNull().references(() => routineDefinitions.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("preview"),
  candidateCount: integer("candidate_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  changedSourceCount: integer("changed_source_count").notNull().default(0),
  previousWindowStats: jsonb("previous_window_stats").notNull().default({}).$type<Record<string, unknown>>(),
  artifactPath: text("artifact_path"),
  commitSha: text("commit_sha"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("routine_digest_artifacts_window_idx").on(table.routineId, table.windowStart, table.windowEnd),
  index("routine_digest_artifacts_company_created_idx").on(table.companyId, table.createdAt),
  check(
    "routine_digest_artifacts_status_check",
    sql`${table.status} in ('preview','committed','failed')`,
  ),
]);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyEncrypted: text("key_encrypted"),
  scopes: text("scopes").array().$type<ApiKeyScope[]>(),
  companyScopeMode: text("company_scope_mode")
    .notNull()
    .default("single_company")
    .$type<ApiKeyCompanyScopeMode>(),
  apiKeyAccessPolicyVersion: text("api_key_access_policy_version")
    .notNull()
    .default("legacy_imported_parent")
    .$type<ApiKeyAccessPolicyVersion>(),
  defaultCompanyId: uuid("default_company_id").references(() => companies.id, {
    onDelete: "set null",
  }),
  allowedCompanyIds: text("allowed_company_ids").array().$type<string[]>(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isRevoked: boolean("is_revoked").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("api_keys_key_hash_key").on(table.keyHash),
  index("api_keys_user_id_idx").on(table.userId),
]);

export const telegramBotUsers = pgTable("telegram_bot_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramUserId: text("telegram_user_id").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  telegramUsername: text("telegram_username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  languageCode: text("language_code"),
  activeCompanyId: uuid("active_company_id").references(() => companies.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("pending"),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("telegram_bot_users_telegram_user_idx").on(table.telegramUserId),
  index("telegram_bot_users_user_idx").on(table.userId),
  index("telegram_bot_users_active_company_idx").on(table.activeCompanyId),
]);

export const telegramBotUpdates = pgTable("telegram_bot_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  updateId: text("update_id").notNull(),
  telegramUserId: text("telegram_user_id"),
  telegramChatId: text("telegram_chat_id"),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  updateType: text("update_type").notNull(),
  status: text("status").notNull().default("received"),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("telegram_bot_updates_update_idx").on(table.updateId),
  index("telegram_bot_updates_user_created_idx").on(table.telegramUserId, table.createdAt),
  index("telegram_bot_updates_company_created_idx").on(table.companyId, table.createdAt),
]);

export const telegramBotThreads = pgTable("telegram_bot_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramUserId: text("telegram_user_id").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
  telegramChatType: text("telegram_chat_type").notNull().default("private"),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  chatThreadId: uuid("chat_thread_id"),
  title: text("title").notNull().default("Telegram chat"),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("telegram_bot_threads_chat_thread_idx").on(table.telegramChatId, table.chatThreadId),
  index("telegram_bot_threads_user_company_idx").on(table.userId, table.companyId, table.updatedAt),
  index("telegram_bot_threads_chat_company_status_idx").on(table.telegramChatId, table.companyId, table.status, table.updatedAt),
  index("telegram_bot_threads_chat_idx").on(table.telegramChatId, table.updatedAt),
]);

export const telegramBotPendingFiles = pgTable("telegram_bot_pending_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramUserId: text("telegram_user_id").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
  telegramMessageId: text("telegram_message_id").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  selectedCompanyId: uuid("selected_company_id").references(() => companies.id, {
    onDelete: "set null",
  }),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  telegramFileId: text("telegram_file_id").notNull(),
  telegramFileUniqueId: text("telegram_file_unique_id"),
  telegramFilePath: text("telegram_file_path"),
  fileKind: text("file_kind").notNull().default("document"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  fileSizeBytes: integer("file_size_bytes"),
  status: text("status").notNull().default("pending_company"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("telegram_bot_pending_files_message_file_idx").on(
    table.telegramChatId,
    table.telegramMessageId,
    table.telegramFileId,
  ),
  index("telegram_bot_pending_files_user_status_idx").on(table.telegramUserId, table.status, table.createdAt),
  index("telegram_bot_pending_files_company_status_idx").on(table.selectedCompanyId, table.status, table.createdAt),
]);

export const telegramBotDeliveries = pgTable("telegram_bot_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  botUserId: uuid("bot_user_id").references(() => telegramBotUsers.id, { onDelete: "set null" }),
  botThreadId: uuid("bot_thread_id").references(() => telegramBotThreads.id, { onDelete: "set null" }),
  telegramUserId: text("telegram_user_id").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
  sourceKind: text("source_kind").notNull(),
  dedupeKey: text("dedupe_key"),
  status: text("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  telegramMessageId: text("telegram_message_id"),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  payload: jsonb("payload").notNull().default({}).$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("telegram_bot_deliveries_dedupe_idx").on(table.dedupeKey),
  index("telegram_bot_deliveries_status_retry_idx").on(table.status, table.nextRetryAt, table.updatedAt),
  index("telegram_bot_deliveries_chat_created_idx").on(table.telegramChatId, table.createdAt),
  index("telegram_bot_deliveries_company_created_idx").on(table.companyId, table.createdAt),
]);

export const codexChatAuthProfiles = pgTable("codex_chat_auth_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  runtime: text("runtime").notNull().default("codex_chat"),
  provider: text("provider").notNull().default("openai"),
  authMode: text("auth_mode").notNull(),
  label: text("label").notNull().default("Codex"),
  status: text("status").notNull().default("pending"),
  configEncrypted: text("config_encrypted"),
  codexHomePath: text("codex_home_path"),
  lastReadyAt: timestamp("last_ready_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("codex_chat_auth_profiles_company_user_idx").on(table.companyId, table.userId, table.updatedAt),
  index("codex_chat_auth_profiles_runtime_status_idx").on(table.runtime, table.status, table.updatedAt),
]);

export const codexChatAuthChallenges = pgTable("codex_chat_auth_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  authProfileId: uuid("auth_profile_id").notNull().references(() => codexChatAuthProfiles.id, { onDelete: "cascade" }),
  challengeType: text("challenge_type").notNull(),
  deviceCode: text("device_code"),
  loginUrl: text("login_url"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("codex_chat_auth_challenges_profile_idx").on(table.authProfileId, table.createdAt),
  index("codex_chat_auth_challenges_status_idx").on(table.status, table.expiresAt),
]);

export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  executor: text("executor").notNull().default("consultant"),
  /**
   * Persona slug — which "persona" the thread belongs to (cfo / legal /
   * marketing / company / personal). `company` is the default for legacy
   * threads created before persona-chats existed.
   */
  personaSlug: text("persona_slug").notNull().default("company"),
  /**
   * First-class thread kind, SQL-filterable. NULL = regular chat. Set to
   * 'onboarding' for chat-first onboarding threads so the chat runtime
   * (and audit queries) can branch without parsing jsonb. Per Architect
   * review §10 + Forge H3.
   */
  kind: text("kind"),
  authProfileId: uuid("auth_profile_id").references(() => codexChatAuthProfiles.id, { onDelete: "set null" }),
  workspaceRoot: text("workspace_root"),
  runtimeMetadata: jsonb("runtime_metadata").notNull().default({}).$type<Record<string, unknown>>(),
  title: text("title").notNull().default("New chat"),
  messages: jsonb("messages").notNull().default([]).$type<Array<Record<string, unknown>>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("chat_threads_company_user_updated_idx").on(table.companyId, table.userId, table.updatedAt),
  index("chat_threads_company_executor_updated_idx").on(table.companyId, table.executor, table.updatedAt),
  index("chat_threads_company_user_persona_updated_idx").on(
    table.companyId,
    table.userId,
    table.personaSlug,
    table.updatedAt,
  ),
]);

/**
 * Long-term persona memory. Each persona (cfo / legal / marketing / …) has
 * a set of structured memory entries scoped to a `(companyId, personaSlug)`
 * pair — shared across all users of the company so the persona stays
 * consistent regardless of who is talking to it. Agents write entries via
 * the `upsert_persona_memory_entry` tool; the active set (recency-sorted,
 * size-budgeted) is injected into the system prompt at chat time.
 *
 * `unique(company_id, persona_slug, kind, title)` is the natural upsert
 * target — the tool calls "ensure entry kind=X title=Y exists with
 * content=Z" and we replace in place rather than appending duplicates.
 */
export const personaMemoryEntries = pgTable("persona_memory_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  personaSlug: text("persona_slug").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("persona_memory_entries_natural_key_idx").on(
    table.companyId,
    table.personaSlug,
    table.kind,
    table.title,
  ),
  index("persona_memory_entries_company_persona_updated_idx").on(
    table.companyId,
    table.personaSlug,
    table.updatedAt,
  ),
  check(
    "persona_memory_entries_content_length_check",
    sql`length(${table.content}) <= 8000`,
  ),
]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  uiMessageId: text("ui_message_id").notNull(),
  role: text("role").notNull(),
  messageIndex: integer("message_index").notNull(),
  textContent: text("text_content"),
  parts: jsonb("parts").notNull().default([]).$type<Array<Record<string, unknown>>>(),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("chat_messages_thread_message_index_idx").on(table.threadId, table.messageIndex),
  index("chat_messages_thread_created_idx").on(table.threadId, table.createdAt),
  index("chat_messages_company_thread_idx").on(table.companyId, table.threadId),
]);

/**
 * Per-user thumbs-up/thumbs-down on assistant messages.
 *
 * Natural key: `(thread_id, ui_message_id, user_id)` — each user can leave
 * at most one feedback per message; flipping their own thumb upserts in
 * place. `persona_slug` is denormalised from `chat_threads` so analytics
 * queries don't need a join.
 */
export const chatFeedback = pgTable("chat_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  uiMessageId: text("ui_message_id").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaSlug: text("persona_slug").notNull().default("company"),
  type: text("type").notNull(), // "positive" | "negative"
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("chat_feedback_natural_key_idx").on(
    table.threadId,
    table.uiMessageId,
    table.userId,
  ),
  index("chat_feedback_company_persona_type_idx").on(
    table.companyId,
    table.personaSlug,
    table.type,
  ),
  index("chat_feedback_thread_idx").on(table.threadId, table.createdAt),
  check(
    "chat_feedback_type_check",
    sql`${table.type} in ('positive','negative')`,
  ),
]);

export const chatAttachments = pgTable("chat_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  uiMessageId: text("ui_message_id"),
  documentId: uuid("document_id").references(() => documents.id),
  kind: text("kind").notNull().default("document"),
  fileName: text("file_name").notNull(),
  fileType: text("file_type"),
  storageUrl: text("storage_url"),
  /**
   * @deprecated Tier A4 (docs/architecture/document-pipeline-stability.md):
   * Read sites derive status from `documents.status` via JOIN. Writers no
   * longer update this column for new rows; legacy rows keep their values
   * for backward read-fallback only. Will be dropped in a follow-up PR
   * once observation window confirms no consumers regressed.
   */
  status: text("status").notNull().default("uploaded"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("chat_attachments_thread_idx").on(table.threadId, table.createdAt),
  index("chat_attachments_company_idx").on(table.companyId, table.createdAt),
  index("chat_attachments_document_idx").on(table.documentId),
]);

export const chatArtifacts = pgTable("chat_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  uiMessageId: text("ui_message_id"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type"),
  status: text("status").notNull().default("draft"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("chat_artifacts_thread_idx").on(table.threadId, table.createdAt),
  index("chat_artifacts_company_status_idx").on(table.companyId, table.status),
]);

export const chatApprovals = pgTable("chat_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  artifactId: uuid("artifact_id").references(() => chatArtifacts.id),
  action: text("action").notNull(),
  status: text("status").notNull().default("pending"),
  requestedBy: text("requested_by").references(() => users.id),
  approvedBy: text("approved_by").references(() => users.id),
  payload: jsonb("payload").notNull().default({}).$type<Record<string, unknown>>(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("chat_approvals_thread_idx").on(table.threadId, table.status),
  index("chat_approvals_company_status_idx").on(table.companyId, table.status),
]);

export const chatRuns = pgTable("chat_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  uiMessageId: text("ui_message_id"),
  provider: text("provider"),
  model: text("model"),
  executor: text("executor"),
  status: text("status").notNull().default("queued"),
  summary: text("summary"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("chat_runs_thread_idx").on(table.threadId, table.createdAt),
  index("chat_runs_company_status_idx").on(table.companyId, table.status),
  // DATA-1: prevents double-insert when two concurrent POSTs both pass the
  // SELECT-then-INSERT guard. Partial index (queued|running only) so completed
  // rows don't block new runs. Matches feat/telegram-orchestrator branch so a
  // future db:push from either branch won't DROP this index.
  // Apply to prod: CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  //   chat_runs_active_thread_uniq ON chat_runs (thread_id)
  //   WHERE status IN ('queued','running');
  uniqueIndex("chat_runs_active_thread_uniq")
    .on(table.threadId)
    .where(sql`status in ('queued','running')`),
]);

export const llmUsageEvents = pgTable("llm_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  subsystem: text("subsystem").notNull(),
  operation: text("operation").notNull(),
  executor: text("executor"),
  billingMode: text("billing_mode"),
  threadId: uuid("thread_id").references(() => chatThreads.id, { onDelete: "set null" }),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("llm_usage_events_company_created_idx").on(table.companyId, table.createdAt),
  index("llm_usage_events_provider_created_idx").on(table.provider, table.createdAt),
  index("llm_usage_events_subsystem_created_idx").on(table.subsystem, table.createdAt),
  index("llm_usage_events_user_created_idx").on(table.userId, table.createdAt),
]);

export const reportJobs = pgTable("report_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  routineRunId: uuid("routine_run_id").references(() => routineRuns.id, { onDelete: "restrict" }),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("planning"),
  requestText: text("request_text").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  plannerVersion: integer("planner_version").notNull().default(1),
  outputFormat: text("output_format").notNull().default("markdown"),
  strictness: text("strictness").notNull().default("standard"),
  intentJson: jsonb("intent_json").notNull().default({}).$type<Record<string, unknown>>(),
  executionPlanJson: jsonb("execution_plan_json").$type<Record<string, unknown>>(),
  executionContextJson: jsonb("execution_context_json").notNull().default({}).$type<Record<string, unknown>>(),
  resultSummaryJson: jsonb("result_summary_json").notNull().default({}).$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("report_jobs_company_status_idx").on(table.companyId, table.status, table.updatedAt),
  index("report_jobs_routine_run_idx").on(table.routineRunId, table.createdAt),
  index("report_jobs_user_created_idx").on(table.requestedByUserId, table.createdAt),
  index("report_jobs_fingerprint_idx").on(table.companyId, table.requestFingerprint, table.createdAt),
]);

export const reportJobArtifacts = pgTable("report_job_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportJobId: uuid("report_job_id").notNull().references(() => reportJobs.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  storageUrl: text("storage_url"),
  downloadPath: text("download_path"),
  viewPath: text("view_path"),
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReason: text("review_reason"),
  publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedTargetDomain: text("published_target_domain"),
  publishedTargetPath: text("published_target_path"),
  commitSha: text("commit_sha"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("report_job_artifacts_job_idx").on(table.reportJobId, table.createdAt),
  index("report_job_artifacts_company_idx").on(table.companyId, table.createdAt),
  index("report_job_artifacts_company_review_idx").on(table.companyId, table.reviewStatus, table.createdAt),
  check(
    "report_job_artifacts_review_status_check",
    sql`${table.reviewStatus} in ('pending','approving','approved','rejected')`,
  ),
]);

export const reportConfigs = pgTable("report_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  reportType: text("report_type").notNull(),
  config: jsonb("config").notNull(),
  fingerprint: text("fingerprint").notNull(),
  familyFingerprint: text("family_fingerprint"),
  version: integer("version").notNull().default(1),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("report_configs_company_fingerprint_idx").on(table.companyId, table.fingerprint),
  index("report_configs_company_family_idx").on(table.companyId, table.familyFingerprint),
  index("report_configs_company_type_idx").on(table.companyId, table.reportType),
]);

export const connectorRegistrations = pgTable("connector_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companySlug: text("company_slug").notNull(),
  source: text("source").notNull(),
  accountId: text("account_id").notNull().default("default"),
  webhookSecret: text("webhook_secret"),
  isActive: boolean("is_active").default(true).notNull(),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("connector_reg_source_account_idx").on(table.companySlug, table.source, table.accountId),
  // Webhook routing index — (source, account_id) must be globally unique
  // to prevent tenant misroute. Each provider account belongs to exactly one company.
  uniqueIndex("connector_reg_webhook_route_idx").on(table.source, table.accountId),
]);
