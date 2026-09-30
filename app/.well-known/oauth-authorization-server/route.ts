import { NextRequest, NextResponse } from "next/server";

import {
  buildOAuthAuthorizationServerMetadata,
  buildOAuthMetadataHeaders,
  buildOAuthMetadataOptionsResponse,
} from "@/lib/chatgpt-mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return NextResponse.json(
    buildOAuthAuthorizationServerMetadata(new URL(req.url).origin),
    {
      headers: buildOAuthMetadataHeaders(),
    },
  );
}

export function OPTIONS() {
  return buildOAuthMetadataOptionsResponse();
}
