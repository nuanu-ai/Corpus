import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connections, rawEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { verifyPlaidWebhookSignature } from "@/lib/connectors/plaid-webhook";

interface PlaidWebhookBody {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  removed_transactions?: string[];
  new_transactions?: number;
  error?: Record<string, unknown>;
}

export async function POST(request: Request) {
  // 1. Read raw body for signature verification
  const rawBody = await request.text();

  // 2. Verify signature
  const signature = request.headers.get("plaid-verification");
  if (!(await verifyPlaidWebhookSignature(rawBody, signature))) {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // 3. Parse body
  let body: PlaidWebhookBody;
  try {
    body = JSON.parse(rawBody) as PlaidWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Basic validation: ensure webhook_type exists
  if (!body.webhook_type || !body.item_id) {
    return NextResponse.json(
      { error: "Missing webhook_type or item_id" },
      { status: 400 }
    );
  }

  try {
    // Resolve connection from item_id (exclude credentials)
    const [connection] = await db
      .select({
        id: connections.id,
        companyId: connections.companyId,
        provider: connections.provider,
        status: connections.status,
      })
      .from(connections)
      .where(
        and(
          eq(connections.externalAccountId, body.item_id),
          eq(connections.provider, "plaid"),
          eq(connections.status, "active")
        )
      )
      .limit(1);

    if (!connection) {
      // Return 200 to prevent Plaid from retrying for unknown items
      console.warn(
        `No active Plaid connection found for item: ${body.item_id}. Acknowledging to prevent retries.`
      );
      return NextResponse.json({ received: true });
    }

    if (body.webhook_type === "TRANSACTIONS") {
      switch (body.webhook_code) {
        case "INITIAL_UPDATE":
        case "DEFAULT_UPDATE":
        case "HISTORICAL_UPDATE": {
          // Fire Inngest event to trigger transaction sync
          await inngest.send({
            name: "plaid/transactions.updated",
            data: {
              connectionId: connection.id,
              companyId: connection.companyId,
              webhookCode: body.webhook_code,
            },
          });
          break;
        }

        case "TRANSACTIONS_REMOVED": {
          // Store removed transaction IDs in rawEvents for processing
          const removedIds = body.removed_transactions ?? [];
          if (removedIds.length > 0) {
            const sortedIds = [...removedIds].sort().join(",");
            await db
              .insert(rawEvents)
              .values({
                companyId: connection.companyId,
                connectionId: connection.id,
                sourceEventId: `removed_batch_${sortedIds}`,
                idempotencyKey: `plaid:removed_batch_${sortedIds}`,
                source: "plaid",
                eventType: "transactions.removed",
                rawPayload: {
                  removedTransactionIds: removedIds,
                  webhookCode: body.webhook_code,
                },
              })
              .onConflictDoNothing();
          }
          break;
        }

        default:
          // Unknown transaction webhook code; acknowledge
          break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Plaid webhook error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
