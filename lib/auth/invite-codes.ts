import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export type InviteTier = "managed" | "community";

export interface InviteValidation {
  ok: true;
  tier: InviteTier;
  codeId: string;
}

export interface InviteRejection {
  ok: false;
  reason: "missing" | "unknown" | "expired" | "exhausted" | "invalid_tier";
  message: string;
}

export type InviteResult = InviteValidation | InviteRejection;

/**
 * Validate-and-consume an invite code in one atomic transaction.
 *
 * Returns the tier the new user should inherit, or a rejection reason.
 * On success, increments `used_count` (so a `max_uses=1` code can't be
 * reused). On failure, no DB writes occur.
 *
 * Rare leak: if the BetterAuth signup that follows fails (e.g. duplicate
 * email), the consumed slot is not refunded. Deployments with strict invite
 * accounting should compensate for failed signups at the application layer.
 */
export async function consumeInviteCode(rawCode: string | null | undefined): Promise<InviteResult> {
  const code = (rawCode ?? "").trim();
  if (!code) {
    return { ok: false, reason: "missing", message: "Invite code required" };
  }

  const result = await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, tier, max_uses, used_count, expires_at
      FROM invite_codes
      WHERE code = ${code}
      FOR UPDATE
    `)) as unknown as Array<{
      id: string;
      tier: string;
      max_uses: number | null;
      used_count: number;
      expires_at: Date | null;
    }>;

    if (rows.length === 0) {
      return { ok: false, reason: "unknown", message: "Invite code not recognised" } as const;
    }

    const row = rows[0];

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { ok: false, reason: "expired", message: "Invite code has expired" } as const;
    }

    if (row.max_uses != null && row.used_count >= row.max_uses) {
      return { ok: false, reason: "exhausted", message: "Invite code has been used up" } as const;
    }

    if (row.tier !== "managed" && row.tier !== "community") {
      return { ok: false, reason: "invalid_tier", message: "Invite code has unknown tier" } as const;
    }

    await tx.execute(sql`
      UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ${row.id}::uuid
    `);

    return { ok: true, tier: row.tier as InviteTier, codeId: row.id } as const;
  });

  return result;
}
