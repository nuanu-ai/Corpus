import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyWebhookSignature } from "@/lib/webhook-auth";

export async function POST(req: Request) {
  try {
    const shopDomain = req.headers.get("x-shopify-shop-domain");
    const topic = req.headers.get("x-shopify-topic");

    if (!shopDomain || !topic) {
      return NextResponse.json(
        { error: "Missing Shopify headers" },
        { status: 400 }
      );
    }

    // 1. Read raw body for signature verification
    const rawBody = await req.text();

    // 2. Verify HMAC signature (base64-encoded HMAC-SHA256 of raw body using client secret)
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    if (
      !verifyWebhookSignature(
        rawBody,
        hmacHeader,
        process.env.SHOPIFY_CLIENT_SECRET,
        "base64"
      )
    ) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Only process relevant topics
    const relevantTopics = [
      "orders/paid",
      "orders/updated",
      "refunds/create",
      "payouts/create",
    ];
    if (!relevantTopics.includes(topic)) {
      return NextResponse.json({ received: true });
    }

    // Find connection by shop domain stored in externalAccountId
    const [conn] = await db
      .select({ id: connections.id, companyId: connections.companyId })
      .from(connections)
      .where(
        and(
          eq(connections.provider, "shopify"),
          eq(connections.externalAccountId, shopDomain),
          eq(connections.status, "active")
        )
      )
      .limit(1);

    if (!conn) {
      // Return 200 to prevent Shopify from retrying for unknown connections
      return NextResponse.json({ received: true });
    }

    await inngest.send({
      name: "shopify/sync.requested",
      data: { connectionId: conn.id, companyId: conn.companyId },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Shopify webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
