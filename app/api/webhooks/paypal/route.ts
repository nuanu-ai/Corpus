import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyPayPalWebhookSignature } from "@/lib/connectors/paypal-webhook";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    const verified = await verifyPayPalWebhookSignature(rawBody, {
      transmissionId: req.headers.get("PAYPAL-TRANSMISSION-ID"),
      transmissionTime: req.headers.get("PAYPAL-TRANSMISSION-TIME"),
      transmissionSig: req.headers.get("PAYPAL-TRANSMISSION-SIG"),
      authAlgo: req.headers.get("PAYPAL-AUTH-ALGO"),
      certUrl: req.headers.get("PAYPAL-CERT-URL"),
    });

    if (!verified) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    let body: { event_type: string; resource: Record<string, unknown> };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const eventType = body.event_type;

    // Only process transaction-related events
    const transactionEvents = [
      "PAYMENT.SALE.COMPLETED",
      "PAYMENT.SALE.REFUNDED",
      "PAYMENT.SALE.REVERSED",
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    ];

    if (!transactionEvents.includes(eventType)) {
      return NextResponse.json({ received: true });
    }

    // Find the PayPal connection — require merchant_id for tenant isolation
    const merchantId = body.resource?.merchant_id as string | undefined;

    if (!merchantId) {
      console.warn(
        "PayPal webhook without merchant_id — cannot route safely"
      );
      return NextResponse.json({ received: true });
    }

    const [conn] = await db
      .select({ id: connections.id, companyId: connections.companyId })
      .from(connections)
      .where(
        and(
          eq(connections.provider, "paypal"),
          eq(connections.externalAccountId, merchantId),
          eq(connections.status, "active")
        )
      )
      .limit(1);

    if (!conn) {
      // Return 200 to prevent PayPal from retrying for unknown connections
      return NextResponse.json({ received: true });
    }

    // Trigger a sync for this connection
    await inngest.send({
      name: "paypal/sync.requested",
      data: { connectionId: conn.id, companyId: conn.companyId },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("PayPal webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
