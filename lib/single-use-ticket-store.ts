import { and, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db";
import { verifications } from "@/lib/db/schema";

type SingleUseTicketNamespace =
  | "embed_api_key"
  | "telegram_bot_link";

function buildIdentifier(namespace: SingleUseTicketNamespace): string {
  return `single_use_ticket:${namespace}`;
}

export async function registerSingleUseTicket(input: {
  namespace: SingleUseTicketNamespace;
  id: string;
  expiresAt: Date;
}) {
  await db.insert(verifications).values({
    id: input.id,
    identifier: buildIdentifier(input.namespace),
    value: "pending",
    expiresAt: input.expiresAt,
  });
}

export async function registerSingleUseTicketPayload<T>(input: {
  namespace: SingleUseTicketNamespace;
  id: string;
  payload: T;
  expiresAt: Date;
}) {
  await db.insert(verifications).values({
    id: input.id,
    identifier: buildIdentifier(input.namespace),
    value: JSON.stringify(input.payload),
    expiresAt: input.expiresAt,
  });
}

export async function consumeSingleUseTicket(input: {
  namespace: SingleUseTicketNamespace;
  id: string;
}) {
  const rows = await db
    .delete(verifications)
    .where(
      and(
        eq(verifications.id, input.id),
        eq(verifications.identifier, buildIdentifier(input.namespace)),
        gt(verifications.expiresAt, new Date()),
      ),
    )
    .returning({ id: verifications.id });

  return rows.length > 0;
}

export async function consumeSingleUseTicketPayload<T>(input: {
  namespace: SingleUseTicketNamespace;
  id: string;
}): Promise<T | null> {
  const rows = await db
    .delete(verifications)
    .where(
      and(
        eq(verifications.id, input.id),
        eq(verifications.identifier, buildIdentifier(input.namespace)),
        gt(verifications.expiresAt, new Date()),
      ),
    )
    .returning({
      value: verifications.value,
    });

  const value = rows[0]?.value;
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
