import { NextRequest, NextResponse } from "next/server";

import {
  buildOAuthMetadataHeaders,
  buildOAuthMetadataOptionsResponse,
  buildOAuthProtectedResourceMetadata,
  resolveChatgptMcpPublicOrigin,
} from "@/lib/chatgpt-mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const origin = resolveChatgptMcpPublicOrigin(new URL(req.url).origin);

  return NextResponse.json(
    buildOAuthProtectedResourceMetadata(origin, origin),
    {
      headers: buildOAuthMetadataHeaders(),
    },
  );
}

export function OPTIONS() {
  return buildOAuthMetadataOptionsResponse();
}
