/**
 * Validates a Stripe API key by making a lightweight API call to retrieve the account.
 * Returns the account ID on success, throws on failure.
 */

import Stripe from "stripe";

export interface StripeValidationResult {
  accountId: string;
  displayName: string | null;
  country: string | null;
}

export async function validateStripeApiKey(apiKey: string): Promise<StripeValidationResult> {
  if (!apiKey.startsWith("sk_") && !apiKey.startsWith("rk_")) {
    throw new Error("Invalid Stripe key format. Expected sk_live_*, sk_test_*, or rk_live_*.");
  }

  const stripe = new Stripe(apiKey);

  try {
    const account = await stripe.accounts.retrieve();
    return {
      accountId: account.id,
      displayName: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? null,
      country: account.country ?? null,
    };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
      throw new Error("Invalid Stripe API key. Please check the key and try again.");
    }
    throw err;
  }
}
