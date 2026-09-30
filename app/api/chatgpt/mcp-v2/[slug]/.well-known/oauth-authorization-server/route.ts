import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import {
  buildOAuthAuthorizationServerMetadata,
  buildOAuthMetadataHeaders,
  buildOAuthMetadataOptionsResponse,
} from "@/lib/chatgpt-mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    await context.params;
    return NextResponse.json(
      buildOAuthAuthorizationServerMetadata(new URL(req.url).origin),
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
