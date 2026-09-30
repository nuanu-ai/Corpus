import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";

/**
 * POST /api/api-keys/[id]/reveal — Reveal the plaintext secret for a recoverable key.
 *
 * Legacy keys created before encrypted secret storage cannot be revealed.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await getSessionAuthContext();
    const { id } = await params;

    const rows = await db
      .select({
        id: apiKeys.id,
        keyEncrypted: apiKeys.keyEncrypted,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));

    const key = rows[0];
    if (!key) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    if (!key.keyEncrypted) {
      return NextResponse.json(
        {
          error:
            "This key was created before recoverable storage. Rotate it to get a revealable key.",
        },
        { status: 409 },
      );
    }

    const secret = decrypt(key.keyEncrypted, process.env.ENCRYPTION_KEY as string);
    return NextResponse.json({ key: secret });
  } catch (err) {
    return handleApiError(err);
  }
}
