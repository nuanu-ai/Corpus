import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getPlaidClient, Products, CountryCode } from "@/lib/connectors/plaid";

export async function POST() {
  try {
    const { companyId } = await getSessionCompanyContext();

    const plaidClient = getPlaidClient();

    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: companyId },
      client_name: "Corpus",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Gb, CountryCode.Ca],
      language: "en",
      webhook: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/plaid`,
    });

    return NextResponse.json({ linkToken: response.data.link_token });
  } catch (err) {
    return handleApiError(err);
  }
}
