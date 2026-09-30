import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { verifyWebhookSignature } from "@/lib/webhook-auth";

interface TrueLayerWebhookBody {
  type: string;
  consent_id?: string;
  [key: string]: unknown;
}

export async function POST(request: Request) {
  // 1. Read raw body for signature verification
  const rawBody = await request.text();

  // 2. Verify signature
  const signature = request.headers.get("tl-signature");
  if (
    !verifyWebhookSignature(
      rawBody,
      signature,
      process.env.TRUELAYER_WEBHOOK_SECRET
    )
  ) {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // 3. Parse body
  let body: TrueLayerWebhookBody;
  try {
    body = JSON.parse(rawBody) as TrueLayerWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Basic validation
  if (!body.type) {
    return NextResponse.json(
      { error: "Missing type field" },
      { status: 400 }
    );
  }

  try {
    // For data_available webhooks, trigger a transaction sync
    if (body.type === "data_available" && body.consent_id) {
      // Resolve connection from consent_id (stored as externalAccountId)
      const [connection] = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.externalAccountId, body.consent_id),
            eq(connections.provider, "truelayer"),
            eq(connections.status, "active")
          )
        )
        .limit(1);

      if (!connection) {
        // Return 200 to prevent TrueLayer from retrying for unknown consents
        console.warn(
          `No active TrueLayer connection found for consent: ${body.consent_id}. Acknowledging to prevent retries.`
        );
        return NextResponse.json({ received: true });
      }

      // Fire Inngest event to trigger transaction sync
      await inngest.send({
        name: "truelayer/transactions.updated",
        data: {
          connectionId: connection.id,
          companyId: connection.companyId,
          webhookCode: body.type,
        },
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("TrueLayer webhook error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
