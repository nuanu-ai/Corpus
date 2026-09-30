import { NextRequest, NextResponse } from "next/server";

import {
  buildOAuthMetadataHeaders,
  buildOAuthMetadataOptionsResponse,
  buildOAuthProtectedResourceMetadata,
  resolveChatgptMcpPublicOrigin,
} from "@/lib/chatgpt-mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ resource: string[] }> },
) {
  const { resource } = await context.params;
  const origin = resolveChatgptMcpPublicOrigin(new URL(req.url).origin);
  const resourceUrl = `${origin}/${resource.join("/")}`;

  return NextResponse.json(
    buildOAuthProtectedResourceMetadata(origin, resourceUrl),
    {
      headers: buildOAuthMetadataHeaders(),
    },
  );
}

export function OPTIONS() {
  return buildOAuthMetadataOptionsResponse();
}
