import { db } from "@/lib/db";
import { connections, auditLog } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";
import { eq, and, ne, desc } from "drizzle-orm";

const encryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY environment variable is required");
  return key;
};

function stripEncryptedCredentials<T extends { credentialsEncrypted: string }>(row: T) {
  const { credentialsEncrypted, ...rest } = row;
  void credentialsEncrypted;
  return rest;
}

export async function createConnection(
  companyId: string,
  provider: string,
  credentials: Record<string, unknown>,
  options?: {
    externalAccountId?: string;
    scopes?: string[];
    metadata?: Record<string, unknown>;
  }
) {
  const credentialsEncrypted = encrypt(
    JSON.stringify(credentials),
    encryptionKey()
  );

  const [created] = await db
    .insert(connections)
    .values({
      companyId,
      provider,
      credentialsEncrypted,
      externalAccountId: options?.externalAccountId ?? null,
      scopes: options?.scopes ?? null,
      metadata: options?.metadata ?? {},
    })
    .returning();

  // Return without decrypted credentials
  return stripEncryptedCredentials(created);
}

export async function listConnections(companyId: string) {
  const rows = await db
    .select({
      id: connections.id,
      companyId: connections.companyId,
      provider: connections.provider,
      status: connections.status,
      scopes: connections.scopes,
      externalAccountId: connections.externalAccountId,
      lastSyncAt: connections.lastSyncAt,
      lastError: connections.lastError,
      errorCount: connections.errorCount,
      metadata: connections.metadata,
      createdAt: connections.createdAt,
      updatedAt: connections.updatedAt,
    })
    .from(connections)
    .where(and(eq(connections.companyId, companyId), ne(connections.status, "disconnected")));

  return rows;
}

/** Get a connection by ID without decrypting credentials (safe for API responses). */
export async function getConnectionById(
  connectionId: string,
  companyId: string
) {
  const [row] = await db
    .select({
      id: connections.id,
      companyId: connections.companyId,
      provider: connections.provider,
      status: connections.status,
      scopes: connections.scopes,
      externalAccountId: connections.externalAccountId,
      lastSyncAt: connections.lastSyncAt,
      lastError: connections.lastError,
      errorCount: connections.errorCount,
      metadata: connections.metadata,
      createdAt: connections.createdAt,
      updatedAt: connections.updatedAt,
    })
    .from(connections)
    .where(
      and(eq(connections.id, connectionId), eq(connections.companyId, companyId))
    );

  return row || null;
}

/** Get a connection with decrypted credentials (internal use only — NEVER return to client). */
export async function getConnectionCredentials(
  connectionId: string,
  companyId: string
) {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(eq(connections.id, connectionId), eq(connections.companyId, companyId))
    );

  if (!row) return null;

  const credentials = JSON.parse(
    decrypt(row.credentialsEncrypted, encryptionKey())
  ) as Record<string, unknown>;

  return { ...stripEncryptedCredentials(row), credentials };
}

/** Get the latest non-disconnected connection for a provider with decrypted credentials. */
export async function getLatestConnectionCredentialsByProvider(
  companyId: string,
  provider: string
) {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.companyId, companyId),
        eq(connections.provider, provider),
        ne(connections.status, "disconnected")
      )
    )
    .orderBy(desc(connections.createdAt))
    .limit(1);

  if (!row) return null;

  const credentials = JSON.parse(
    decrypt(row.credentialsEncrypted, encryptionKey())
  ) as Record<string, unknown>;

  return { ...stripEncryptedCredentials(row), credentials };
}

/** Update encrypted credentials and optional metadata for an existing connection. */
export async function updateConnectionCredentials(
  connectionId: string,
  companyId: string,
  credentials: Record<string, unknown>,
  options?: {
    metadata?: Record<string, unknown>;
    status?: string;
    externalAccountId?: string | null;
    lastError?: string | null;
  }
) {
  const credentialsEncrypted = encrypt(
    JSON.stringify(credentials),
    encryptionKey()
  );

  const values: {
    credentialsEncrypted: string;
    updatedAt: Date;
    metadata?: Record<string, unknown>;
    status?: string;
    externalAccountId?: string | null;
    lastError?: string | null;
  } = {
    credentialsEncrypted,
    updatedAt: new Date(),
  };

  if (options?.metadata !== undefined) {
    values.metadata = options.metadata;
  }
  if (options?.status !== undefined) {
    values.status = options.status;
  }
  if (options?.externalAccountId !== undefined) {
    values.externalAccountId = options.externalAccountId;
  }
  if (options?.lastError !== undefined) {
    values.lastError = options.lastError;
  }

  const [updated] = await db
    .update(connections)
    .set(values)
    .where(
      and(eq(connections.id, connectionId), eq(connections.companyId, companyId))
    )
    .returning();

  if (!updated) return null;

  return stripEncryptedCredentials(updated);
}

export async function deleteConnection(
  connectionId: string,
  companyId: string,
  userId: string
) {
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(connections)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(
        and(eq(connections.id, connectionId), eq(connections.companyId, companyId))
      )
      .returning();

    if (!updated) return null;

    await tx.insert(auditLog).values({
      companyId,
      userId,
      action: "disconnect",
      entityType: "connection",
      entityId: connectionId,
      oldValue: {
        provider: updated.provider,
        status: "active",
        externalAccountId: updated.externalAccountId,
      },
    });

    return stripEncryptedCredentials(updated);
  });
}
