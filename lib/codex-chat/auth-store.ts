import { and, desc, eq, inArray } from "drizzle-orm";

import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  codexChatAuthChallenges,
  codexChatAuthProfiles,
} from "@/lib/db/schema";

import {
  type CodexChatAuthChallengeStatus,
  type CodexChatAuthChallengeType,
  CODEX_CHAT_EXECUTOR,
  type CodexChatAuthMode,
  type CodexChatAuthStatus,
} from "./types";

interface CodexChatApiKeyConfig {
  apiKey: string;
}

export interface PublicCodexChatAuthProfile {
  id: string;
  companyId: string;
  userId: string;
  runtime: string;
  provider: string;
  authMode: CodexChatAuthMode;
  label: string;
  status: CodexChatAuthStatus;
  codexHomePath: string | null;
  lastReadyAt: string | null;
  lastFailureAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PublicCodexChatAuthChallenge {
  id: string;
  authProfileId: string;
  challengeType: string;
  deviceCode: string | null;
  loginUrl: string | null;
  status: CodexChatAuthChallengeStatus;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required");
  }
  return key;
}

function toPublicProfile(
  row: typeof codexChatAuthProfiles.$inferSelect,
): PublicCodexChatAuthProfile {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    runtime: row.runtime,
    provider: row.provider,
    authMode: row.authMode as CodexChatAuthMode,
    label: row.label,
    status: row.status as CodexChatAuthStatus,
    codexHomePath: row.codexHomePath ?? null,
    lastReadyAt: row.lastReadyAt?.toISOString() ?? null,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicChallenge(
  row: typeof codexChatAuthChallenges.$inferSelect,
): PublicCodexChatAuthChallenge {
  return {
    id: row.id,
    authProfileId: row.authProfileId,
    challengeType: row.challengeType,
    deviceCode: row.deviceCode ?? null,
    loginUrl: row.loginUrl ?? null,
    status: row.status as CodexChatAuthChallengeStatus,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCodexChatAuthProfiles(input: {
  companyId: string;
  userId: string;
}): Promise<PublicCodexChatAuthProfile[]> {
  const rows = await db
    .select()
    .from(codexChatAuthProfiles)
    .where(
      and(
        eq(codexChatAuthProfiles.companyId, input.companyId),
        eq(codexChatAuthProfiles.userId, input.userId),
        eq(codexChatAuthProfiles.runtime, CODEX_CHAT_EXECUTOR),
      ),
    )
    .orderBy(desc(codexChatAuthProfiles.updatedAt));

  return rows.map(toPublicProfile);
}

export async function getLatestCodexChatAuthProfile(input: {
  companyId: string;
  userId: string;
}): Promise<PublicCodexChatAuthProfile | null> {
  const [row] = await db
    .select()
    .from(codexChatAuthProfiles)
    .where(
      and(
        eq(codexChatAuthProfiles.companyId, input.companyId),
        eq(codexChatAuthProfiles.userId, input.userId),
        eq(codexChatAuthProfiles.runtime, CODEX_CHAT_EXECUTOR),
      ),
    )
    .orderBy(desc(codexChatAuthProfiles.updatedAt))
    .limit(1);

  return row ? toPublicProfile(row) : null;
}

export async function getCodexChatAuthProfileById(input: {
  companyId: string;
  userId: string;
  profileId: string;
}): Promise<PublicCodexChatAuthProfile | null> {
  const [row] = await db
    .select()
    .from(codexChatAuthProfiles)
    .where(
      and(
        eq(codexChatAuthProfiles.id, input.profileId),
        eq(codexChatAuthProfiles.companyId, input.companyId),
        eq(codexChatAuthProfiles.userId, input.userId),
        eq(codexChatAuthProfiles.runtime, CODEX_CHAT_EXECUTOR),
      ),
    )
    .limit(1);

  return row ? toPublicProfile(row) : null;
}

async function findReusableAuthProfile(input: {
  companyId: string;
  userId: string;
  authMode: CodexChatAuthMode;
}) {
  const [row] = await db
    .select()
    .from(codexChatAuthProfiles)
    .where(
      and(
        eq(codexChatAuthProfiles.companyId, input.companyId),
        eq(codexChatAuthProfiles.userId, input.userId),
        eq(codexChatAuthProfiles.runtime, CODEX_CHAT_EXECUTOR),
        eq(codexChatAuthProfiles.authMode, input.authMode),
      ),
    )
    .orderBy(desc(codexChatAuthProfiles.updatedAt))
    .limit(1);

  return row ?? null;
}

export async function saveCodexChatApiKeyProfile(input: {
  companyId: string;
  userId: string;
  apiKey: string;
  label?: string | null;
  codexHomePath?: string | null;
}): Promise<PublicCodexChatAuthProfile> {
  const trimmedKey = input.apiKey.trim();
  if (!trimmedKey.startsWith("sk-")) {
    throw new Error("OpenAI API key must start with sk-");
  }

  const now = new Date();
  const encryptedConfig = encrypt(
    JSON.stringify({ apiKey: trimmedKey } satisfies CodexChatApiKeyConfig),
    getEncryptionKey(),
  );
  const reusable = await findReusableAuthProfile({
    companyId: input.companyId,
    userId: input.userId,
    authMode: "api_key",
  });

  if (reusable) {
    const [row] = await db
      .update(codexChatAuthProfiles)
      .set({
        label: input.label?.trim() || reusable.label,
        status: "ready",
        configEncrypted: encryptedConfig,
        codexHomePath: input.codexHomePath ?? reusable.codexHomePath,
        lastReadyAt: now,
        updatedAt: now,
        metadata: {
          ...(reusable.metadata ?? {}),
          billingMode: "api_key",
          hasApiKey: true,
        },
      })
      .where(eq(codexChatAuthProfiles.id, reusable.id))
      .returning();

    return toPublicProfile(row);
  }

  const [row] = await db
    .insert(codexChatAuthProfiles)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      runtime: CODEX_CHAT_EXECUTOR,
      provider: "openai",
      authMode: "api_key",
      label: input.label?.trim() || "Codex API key",
      status: "ready",
      configEncrypted: encryptedConfig,
      codexHomePath: input.codexHomePath ?? null,
      lastReadyAt: now,
      metadata: {
        billingMode: "api_key",
        hasApiKey: true,
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toPublicProfile(row);
}

export async function saveCodexChatLoginProfile(input: {
  companyId: string;
  userId: string;
  label?: string | null;
  codexHomePath?: string | null;
}): Promise<PublicCodexChatAuthProfile> {
  const now = new Date();
  const reusable = await findReusableAuthProfile({
    companyId: input.companyId,
    userId: input.userId,
    authMode: "chatgpt_login",
  });

  if (reusable) {
    const [row] = await db
      .update(codexChatAuthProfiles)
      .set({
        label: input.label?.trim() || reusable.label,
        status: "pending",
        codexHomePath: input.codexHomePath ?? reusable.codexHomePath,
        lastFailureAt: null,
        updatedAt: now,
        metadata: {
          ...(reusable.metadata ?? {}),
          billingMode: "chatgpt_login",
          deviceLogin: true,
        },
      })
      .where(eq(codexChatAuthProfiles.id, reusable.id))
      .returning();

    return toPublicProfile(row);
  }

  const [row] = await db
    .insert(codexChatAuthProfiles)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      runtime: CODEX_CHAT_EXECUTOR,
      provider: "openai",
      authMode: "chatgpt_login",
      label: input.label?.trim() || "Codex ChatGPT login",
      status: "pending",
      configEncrypted: null,
      codexHomePath: input.codexHomePath ?? null,
      metadata: {
        billingMode: "chatgpt_login",
        deviceLogin: true,
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toPublicProfile(row);
}

export async function updateCodexChatAuthProfileState(input: {
  companyId: string;
  userId: string;
  profileId: string;
  status: CodexChatAuthStatus;
  lastReadyAt?: Date | null;
  lastFailureAt?: Date | null;
  metadata?: Record<string, unknown>;
}): Promise<PublicCodexChatAuthProfile | null> {
  const [current] = await db
    .select()
    .from(codexChatAuthProfiles)
    .where(
      and(
        eq(codexChatAuthProfiles.id, input.profileId),
        eq(codexChatAuthProfiles.companyId, input.companyId),
        eq(codexChatAuthProfiles.userId, input.userId),
      ),
    )
    .limit(1);

  if (!current) return null;

  const [row] = await db
    .update(codexChatAuthProfiles)
    .set({
      status: input.status,
      lastReadyAt: input.lastReadyAt === undefined ? current.lastReadyAt : input.lastReadyAt,
      lastFailureAt:
        input.lastFailureAt === undefined ? current.lastFailureAt : input.lastFailureAt,
      metadata: input.metadata ? { ...(current.metadata ?? {}), ...input.metadata } : current.metadata,
      updatedAt: new Date(),
    })
    .where(eq(codexChatAuthProfiles.id, current.id))
    .returning();

  return toPublicProfile(row);
}

export async function disconnectCodexChatAuthProfile(input: {
  companyId: string;
  userId: string;
  profileId?: string | null;
}): Promise<PublicCodexChatAuthProfile | null> {
  const target = input.profileId
    ? await db
        .select()
        .from(codexChatAuthProfiles)
        .where(
          and(
            eq(codexChatAuthProfiles.id, input.profileId),
            eq(codexChatAuthProfiles.companyId, input.companyId),
            eq(codexChatAuthProfiles.userId, input.userId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : await findReusableAuthProfile({
        companyId: input.companyId,
        userId: input.userId,
        authMode: "api_key",
      });

  if (!target) return null;

  const [row] = await db
    .update(codexChatAuthProfiles)
    .set({
      status: "disconnected",
      lastFailureAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        ...(target.metadata ?? {}),
        disconnected: true,
      },
    })
    .where(eq(codexChatAuthProfiles.id, target.id))
    .returning();

  return toPublicProfile(row);
}

export async function getLatestCodexChatAuthChallenge(input: {
  companyId: string;
  userId: string;
  authProfileId: string;
}): Promise<PublicCodexChatAuthChallenge | null> {
  const [row] = await db
    .select({ challenge: codexChatAuthChallenges })
    .from(codexChatAuthChallenges)
    .innerJoin(
      codexChatAuthProfiles,
      eq(codexChatAuthProfiles.id, codexChatAuthChallenges.authProfileId),
    )
    .where(
      and(
        eq(codexChatAuthProfiles.companyId, input.companyId),
        eq(codexChatAuthProfiles.userId, input.userId),
        eq(codexChatAuthChallenges.authProfileId, input.authProfileId),
      ),
    )
    .orderBy(desc(codexChatAuthChallenges.createdAt))
    .limit(1);

  return row?.challenge ? toPublicChallenge(row.challenge) : null;
}

export async function getCodexChatAuthChallengeById(input: {
  companyId: string;
  userId: string;
  challengeId: string;
}): Promise<PublicCodexChatAuthChallenge | null> {
  const [row] = await db
    .select({ challenge: codexChatAuthChallenges })
    .from(codexChatAuthChallenges)
    .innerJoin(
      codexChatAuthProfiles,
      eq(codexChatAuthProfiles.id, codexChatAuthChallenges.authProfileId),
    )
    .where(
      and(
        eq(codexChatAuthProfiles.companyId, input.companyId),
        eq(codexChatAuthProfiles.userId, input.userId),
        eq(codexChatAuthChallenges.id, input.challengeId),
      ),
    )
    .limit(1);

  return row?.challenge ? toPublicChallenge(row.challenge) : null;
}

export async function createCodexChatAuthChallenge(input: {
  authProfileId: string;
  challengeType: CodexChatAuthChallengeType;
  deviceCode?: string | null;
  loginUrl?: string | null;
  status?: CodexChatAuthChallengeStatus;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}): Promise<PublicCodexChatAuthChallenge> {
  const [row] = await db
    .insert(codexChatAuthChallenges)
    .values({
      authProfileId: input.authProfileId,
      challengeType: input.challengeType,
      deviceCode: input.deviceCode ?? null,
      loginUrl: input.loginUrl ?? null,
      status: input.status ?? "pending",
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return toPublicChallenge(row);
}

export async function updateCodexChatAuthChallenge(input: {
  challengeId: string;
  patch: Partial<{
    deviceCode: string | null;
    loginUrl: string | null;
    status: CodexChatAuthChallengeStatus;
    expiresAt: Date | null;
    metadata: Record<string, unknown>;
  }>;
}): Promise<PublicCodexChatAuthChallenge | null> {
  const [current] = await db
    .select()
    .from(codexChatAuthChallenges)
    .where(eq(codexChatAuthChallenges.id, input.challengeId))
    .limit(1);

  if (!current) return null;

  const [row] = await db
    .update(codexChatAuthChallenges)
    .set({
      deviceCode:
        input.patch.deviceCode === undefined ? current.deviceCode : input.patch.deviceCode,
      loginUrl: input.patch.loginUrl === undefined ? current.loginUrl : input.patch.loginUrl,
      status: input.patch.status ?? (current.status as CodexChatAuthChallengeStatus),
      expiresAt: input.patch.expiresAt === undefined ? current.expiresAt : input.patch.expiresAt,
      metadata: input.patch.metadata
        ? { ...(current.metadata ?? {}), ...input.patch.metadata }
        : current.metadata,
      updatedAt: new Date(),
    })
    .where(eq(codexChatAuthChallenges.id, current.id))
    .returning();

  return toPublicChallenge(row);
}

export async function expireCodexChatChallenges(input: {
  authProfileId: string;
  statuses?: CodexChatAuthChallengeStatus[];
}): Promise<void> {
  const statuses =
    input.statuses && input.statuses.length > 0
      ? input.statuses
      : (["pending", "awaiting_user"] satisfies CodexChatAuthChallengeStatus[]);

  if (statuses.length === 0) return;

  await db
    .update(codexChatAuthChallenges)
    .set({
      status: "expired",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(codexChatAuthChallenges.authProfileId, input.authProfileId),
        inArray(codexChatAuthChallenges.status, statuses),
      ),
    );
}

export async function readCodexChatApiKey(profileId: string): Promise<string | null> {
  const [row] = await db
    .select({
      configEncrypted: codexChatAuthProfiles.configEncrypted,
    })
    .from(codexChatAuthProfiles)
    .where(eq(codexChatAuthProfiles.id, profileId))
    .limit(1);

  if (!row?.configEncrypted) return null;
  const decoded = JSON.parse(decrypt(row.configEncrypted, getEncryptionKey())) as CodexChatApiKeyConfig;
  return decoded.apiKey ?? null;
}
