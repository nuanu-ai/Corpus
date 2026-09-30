import { createHash, randomBytes } from "crypto";

import { eq } from "drizzle-orm";

import {
  CONNECTOR_USE_API_KEY_SCOPES,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";

export const CODEX_CHAT_AGENT_API_KEY_SCOPES: ApiKeyScope[] = [
  "companies.read",
  "profile.read",
  "settings.read",
  "dashboard.read",
  "people.read",
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.read",
  ...CONNECTOR_USE_API_KEY_SCOPES,
  "documents.read",
  "documents.write",
];

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required");
  }
  return key;
}

export function resolveCodexChatAgentAppUrl(): string {
  const explicitInternal = process.env.CORPUS_INTERNAL_APP_URL?.trim();
  if (explicitInternal) {
    return explicitInternal.replace(/\/$/, "");
  }

  return "http://127.0.0.1:3000";
}

export interface CodexChatEphemeralAgentKey {
  id: string;
  plaintext: string;
  appUrl: string;
  companyId: string;
  expiresAt: Date;
  scopes: ApiKeyScope[];
}

export async function createCodexChatEphemeralAgentKey(input: {
  userId: string;
  companyId: string;
  runId: string;
  threadId: string;
}): Promise<CodexChatEphemeralAgentKey> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const randomHex = randomBytes(16).toString("hex");
  const plaintext = `corpus_sk_${randomHex}`;
  const keyHash = createHash("sha256").update(plaintext).digest("hex");
  const keyPrefix = randomHex.slice(0, 8);
  const scopes = [...CODEX_CHAT_AGENT_API_KEY_SCOPES];

  const [inserted] = await db
    .insert(apiKeys)
    .values({
      userId: input.userId,
      name: `Codex Chat Runtime ${input.threadId} ${input.runId}`,
      keyHash,
      keyPrefix,
      keyEncrypted: encrypt(plaintext, getEncryptionKey()),
      scopes,
      companyScopeMode: "single_company",
      defaultCompanyId: input.companyId,
      allowedCompanyIds: [input.companyId],
      expiresAt,
      createdAt: now,
    })
    .returning({ id: apiKeys.id });

  return {
    id: inserted.id,
    plaintext,
    appUrl: resolveCodexChatAgentAppUrl(),
    companyId: input.companyId,
    expiresAt,
    scopes,
  };
}

export async function revokeCodexChatEphemeralAgentKey(keyId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({
      isRevoked: true,
    })
    .where(eq(apiKeys.id, keyId));
}
