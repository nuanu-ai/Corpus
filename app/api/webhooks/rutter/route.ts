import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyWebhookSignature } from "@/lib/webhook-auth";

export async function POST(req: Request) {
  try {
    // 1. Read raw body for signature verification
    const rawBody = await req.text();

    // 2. Verify signature (HMAC-SHA256 hex digest)
    const signature = req.headers.get("x-rutter-signature");
    if (
      !verifyWebhookSignature(
        rawBody,
        signature,
        process.env.RUTTER_WEBHOOK_SECRET
      )
    ) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // 3. Parse body
    let body: { type: string; connection_id: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const relevantTypes = [
      "TRANSACTION_CREATED",
      "TRANSACTION_UPDATED",
      "INITIAL_UPDATE",
    ];

    if (!relevantTypes.includes(body.type)) {
      return NextResponse.json({ received: true });
    }

    // Find connection by rutter connection_id stored in externalAccountId
    const [conn] = await db
      .select({ id: connections.id, companyId: connections.companyId })
      .from(connections)
      .where(
        and(
          eq(connections.provider, "rutter"),
          eq(connections.externalAccountId, body.connection_id),
          eq(connections.status, "active")
        )
      )
      .limit(1);

    if (!conn) {
      // Return 200 to prevent Rutter from retrying for unknown connections
      return NextResponse.json({ received: true });
    }

    await inngest.send({
      name: "rutter/sync.requested",
      data: { connectionId: conn.id, companyId: conn.companyId },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Rutter webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
