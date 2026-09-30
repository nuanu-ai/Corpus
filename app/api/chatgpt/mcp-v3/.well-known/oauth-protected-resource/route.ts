import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import {
  buildOAuthMetadataHeaders,
  buildOAuthMetadataOptionsResponse,
  buildOAuthProtectedResourceMetadata,
  resolveChatgptMcpPublicOrigin,
} from "@/lib/chatgpt-mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const origin = resolveChatgptMcpPublicOrigin(new URL(req.url).origin);
    const resource = `${origin}/api/chatgpt/mcp-v3`;

    return NextResponse.json(
      buildOAuthProtectedResourceMetadata(origin, resource),
      {
        headers: buildOAuthMetadataHeaders(),
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export function OPTIONS() {
  return buildOAuthMetadataOptionsResponse();
}
