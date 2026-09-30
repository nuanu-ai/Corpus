import { NextResponse } from "next/server";
import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import { listUiOAuthProviderConfigs } from "@/lib/oauth-providers";

export async function GET() {
  try {
    await getSessionAuthContext();

    const status: Record<string, { configured: boolean }> = {};

    for (const [slug, config] of listUiOAuthProviderConfigs()) {
      const hasClientId = !!process.env[config.clientIdEnv];
      const hasClientSecret = !!process.env[config.clientSecretEnv];
      status[slug] = { configured: hasClientId && hasClientSecret };
    }

    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}
