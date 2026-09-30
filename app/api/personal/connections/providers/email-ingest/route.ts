import { NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";

import { ensurePersonalEmailIngestAddress } from "./helpers";

export async function GET() {
  try {
    const auth = await getSessionPersonalProjectContext();
    const result = await ensurePersonalEmailIngestAddress(auth.projectId, false);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST() {
  try {
    const auth = await getSessionPersonalProjectContext();
    const result = await ensurePersonalEmailIngestAddress(auth.projectId, true);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
