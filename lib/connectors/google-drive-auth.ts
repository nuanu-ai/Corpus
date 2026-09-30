import { and, desc, eq } from "drizzle-orm";

import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { refreshDriveAccessToken } from "@/lib/connectors/google-drive";

interface GoogleDriveConnectionRow {
  id: string;
  companyId: string;
  provider: string;
  credentialsEncrypted: string;
  metadata: Record<string, unknown> | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const GOOGLE_DRIVE_TOKEN_SKEW_MS = 60_000;

function buildGoogleDriveAuthError(
  message: string,
  statusCode: number
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required");
  }
  return key;
}

function getTokenExpiresAt(
  connection: GoogleDriveConnectionRow,
  credentials: Record<string, unknown>,
): number | null {
  const candidates = [
    (connection.metadata as Record<string, unknown> | null)?.tokenExpiresAt,
    credentials.tokenExpiresAt,
    credentials.expires_at,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function listActiveGoogleDriveConnections(
  companyId: string
): Promise<GoogleDriveConnectionRow[]> {
  return db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.companyId, companyId),
        eq(connections.provider, "google_drive"),
        eq(connections.status, "active")
      )
    )
    .orderBy(desc(connections.updatedAt), desc(connections.createdAt));
}

export async function resolveGoogleDriveConnection(
  companyId: string,
  options?: { connectionId?: string }
): Promise<GoogleDriveConnectionRow> {
  const activeConnections = await listActiveGoogleDriveConnections(companyId);

  if (activeConnections.length === 0) {
    throw buildGoogleDriveAuthError(
      "No active Google Drive connection found. Please connect Google Drive first.",
      404
    );
  }

  if (options?.connectionId) {
    const selected = activeConnections.find(
      (connection) => connection.id === options.connectionId
    );
    if (!selected) {
      throw buildGoogleDriveAuthError(
        "Google Drive connection not found for this company.",
        404
      );
    }
    return selected;
  }

  if (activeConnections.length > 1) {
    throw buildGoogleDriveAuthError(
      "Multiple Google Drive connections are active for this company. Provide connectionId.",
      400
    );
  }

  return activeConnections[0];
}

export async function getGoogleDriveAccessTokenForConnection(
  connection: GoogleDriveConnectionRow
): Promise<string> {
  const credentials = JSON.parse(
    decrypt(connection.credentialsEncrypted, getEncryptionKey())
  ) as Record<string, unknown>;

  const accessToken = credentials.access_token as string | undefined;
  const tokenExpiresAt = getTokenExpiresAt(connection, credentials);
  if (
    accessToken &&
    tokenExpiresAt !== null &&
    tokenExpiresAt - GOOGLE_DRIVE_TOKEN_SKEW_MS > Date.now()
  ) {
    return accessToken;
  }

  const refreshToken = credentials.refresh_token as string | undefined;
  if (refreshToken) {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET are required"
      );
    }

    const refreshed = await refreshDriveAccessToken(
      refreshToken,
      clientId,
      clientSecret
    );
    return refreshed.access_token;
  }

  if (!accessToken) {
    throw new Error(
      "Google Drive connection has no access token or refresh token"
    );
  }

  return accessToken;
}

export async function getGoogleDriveAccessToken(
  companyId: string,
  options?: { connectionId?: string }
): Promise<string> {
  const connection = await resolveGoogleDriveConnection(companyId, options);
  return getGoogleDriveAccessTokenForConnection(connection);
}
