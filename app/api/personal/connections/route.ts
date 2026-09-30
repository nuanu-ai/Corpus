import { NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { listConnections } from "@/lib/connections";

export async function GET() {
  try {
    const auth = await getSessionPersonalProjectContext();
    const connections = await listConnections(auth.projectId);

    return NextResponse.json(connections, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
