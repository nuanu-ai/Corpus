import { and, eq } from "drizzle-orm";

import { encrypt, decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { userApiKeys } from "@/lib/db/schema";

/** Currently supported BYOK providers — extend cautiously. */
export const SUPPORTED_BYOK_PROVIDERS = ["openai", "codex"] as const;
export type ByokProvider = (typeof SUPPORTED_BYOK_PROVIDERS)[number];

export function isByokProvider(value: string): value is ByokProvider {
  return (SUPPORTED_BYOK_PROVIDERS as readonly string[]).includes(value);
}

/** Public summary of a stored key — never contains the plaintext. */
export interface UserApiKeySummary {
  id: string;
  provider: ByokProvider;
  label: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Last 4 chars to help the user recognise which key is which. */
  preview: string;
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required");
  }
  return key;
}

function buildPreview(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) return "****";
  return `…${trimmed.slice(-4)}`;
}

export async function listUserApiKeys(userId: string): Promise<UserApiKeySummary[]> {
  const rows = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .orderBy(userApiKeys.createdAt);

  const key = getEncryptionKey();
  return rows.map((row) => {
    let preview: string;
    try {
      preview = buildPreview(decrypt(row.keyEncrypted, key));
    } catch {
      preview = "(decrypt failed)";
    }
    return {
      id: row.id,
      provider: row.provider as ByokProvider,
      label: row.label,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      preview,
    };
  });
}

/**
 * Insert or update a user's API key for the given provider.
 * Plaintext is encrypted at rest with ENCRYPTION_KEY.
 */
export async function setUserApiKey(input: {
  userId: string;
  provider: ByokProvider;
  plaintext: string;
  label?: string | null;
}): Promise<UserApiKeySummary> {
  const trimmed = input.plaintext.trim();
  if (trimmed.length < 8) {
    throw new Error("API key looks too short");
  }
  if (trimmed.length > 4096) {
    throw new Error("API key looks too long");
  }

  const key = getEncryptionKey();
  const encrypted = encrypt(trimmed, key);

  const existing = await db
    .select()
    .from(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, input.userId),
        eq(userApiKeys.provider, input.provider),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(userApiKeys)
      .set({
        keyEncrypted: encrypted,
        label: input.label ?? null,
        updatedAt: new Date(),
      })
      .where(eq(userApiKeys.id, existing[0].id))
      .returning();
    return {
      id: updated.id,
      provider: updated.provider as ByokProvider,
      label: updated.label,
      lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      preview: buildPreview(trimmed),
    };
  }

  const [inserted] = await db
    .insert(userApiKeys)
    .values({
      userId: input.userId,
      provider: input.provider,
      keyEncrypted: encrypted,
      label: input.label ?? null,
    })
    .returning();

  return {
    id: inserted.id,
    provider: inserted.provider as ByokProvider,
    label: inserted.label,
    lastUsedAt: null,
    createdAt: inserted.createdAt.toISOString(),
    updatedAt: inserted.updatedAt.toISOString(),
    preview: buildPreview(trimmed),
  };
}

export async function deleteUserApiKey(input: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const result = await db
    .delete(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, input.userId),
        eq(userApiKeys.id, input.id),
      ),
    )
    .returning({ id: userApiKeys.id });
  return result.length > 0;
}

/**
 * Server-side helper for chat / Whisper / codex-worker routing in PR #6.
 * Returns the decrypted plaintext key for the given user + provider, or null.
 * Updates lastUsedAt opportunistically (best-effort, non-blocking on errors).
 */
export async function getUserApiKeyPlaintext(input: {
  userId: string;
  provider: ByokProvider;
}): Promise<string | null> {
  const [row] = await db
    .select()
    .from(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, input.userId),
        eq(userApiKeys.provider, input.provider),
      ),
    )
    .limit(1);
  if (!row) return null;

  let plaintext: string;
  try {
    plaintext = decrypt(row.keyEncrypted, getEncryptionKey());
  } catch (err) {
    console.error(`[byok] decrypt failed for userId=${input.userId} provider=${input.provider}:`, err);
    return null;
  }

  // Best-effort lastUsedAt bump.
  void db
    .update(userApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(userApiKeys.id, row.id))
    .catch((err) => console.warn("[byok] lastUsedAt update failed:", err));

  return plaintext;
}
