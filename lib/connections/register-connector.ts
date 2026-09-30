/**
 * Creates a connector_registrations row when a new connection is established.
 *
 * The connector_registrations table is used by the generic webhook ingest pipeline
 * (POST /api/webhooks/ingest?source=<provider>) to route incoming webhooks to the
 * correct company_slug.
 */

import { db } from "@/lib/db";
import { connectorRegistrations } from "@/lib/db/schema";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";

export async function registerConnector(
  companyId: string,
  source: string,
  options?: { accountId?: string; webhookSecret?: string | null }
): Promise<{ companySlug: string; accountId: string; webhookSecret: string | null }> {
  const companySlug = await getCompanySlug(companyId);
  const accountId = options?.accountId || "default";

  // Generate a webhook secret for signature verification.
  // Pass `null` explicitly to skip generation (e.g. Stripe uses its own
  // endpoint secret from env var, not a DB-stored secret).
  const webhookSecret =
    options?.webhookSecret === null
      ? null
      : options?.webhookSecret || generateWebhookSecret();

  const [inserted] = await db
    .insert(connectorRegistrations)
    .values({
      companySlug,
      source,
      accountId,
      webhookSecret,
    })
    .onConflictDoNothing()
    .returning({
      webhookSecret: connectorRegistrations.webhookSecret,
    });

  if (inserted) {
    return { companySlug, accountId, webhookSecret: inserted.webhookSecret };
  }

  const [existing] = await db
    .select({
      webhookSecret: connectorRegistrations.webhookSecret,
    })
    .from(connectorRegistrations)
    .where(and(
      eq(connectorRegistrations.companySlug, companySlug),
      eq(connectorRegistrations.source, source),
      eq(connectorRegistrations.accountId, accountId),
    ))
    .limit(1);

  if (!existing) {
    throw new Error(
      `Connector registration conflict for source=${source} accountId=${accountId} is owned by another company`,
    );
  }

  return { companySlug, accountId, webhookSecret: existing.webhookSecret };
}

function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}
