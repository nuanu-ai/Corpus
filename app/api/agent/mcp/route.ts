import { NextRequest } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import { handleAgentMcpRequest } from "@/lib/agent/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxyAgentMcp(req: NextRequest) {
  try {
    return await handleAgentMcpRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(req: NextRequest) {
  return proxyAgentMcp(req);
}

export async function POST(req: NextRequest) {
  return proxyAgentMcp(req);
}

export async function DELETE(req: NextRequest) {
  return proxyAgentMcp(req);
}
