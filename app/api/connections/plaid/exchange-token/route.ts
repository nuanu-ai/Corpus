import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getPlaidClient } from "@/lib/connectors/plaid";
import { createConnection } from "@/lib/connections";
import { inngest } from "@/lib/inngest";

export async function POST(request: Request) {
  try {
    const { companyId } = await getSessionCompanyContext();

    const body = (await request.json()) as {
      publicToken: string;
      institutionId?: string;
      institutionName?: string;
    };

    if (!body.publicToken) {
      return NextResponse.json(
        { error: "publicToken is required" },
        { status: 400 }
      );
    }

    const plaidClient = getPlaidClient();

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: body.publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Store connection with encrypted credentials
    const connection = await createConnection(
      companyId,
      "plaid",
      { accessToken, itemId },
      { externalAccountId: itemId }
    );

    // Trigger initial sync
    await inngest.send({
      name: "connection/plaid.connected",
      data: {
        connectionId: connection.id,
        companyId,
      },
    });

    return NextResponse.json({
      connectionId: connection.id,
      status: "connected",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
