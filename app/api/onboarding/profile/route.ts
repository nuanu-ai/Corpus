/**
 * PATCH/POST /api/onboarding/profile
 *
 * Partial profile-field update for the chat-onboarding surface. Unlike
 * /api/onboarding/complete (which requires companyName and MARKS onboarding
 * complete on every call), this writes only the provided fields to their
 * canonical locations and does NOT change completion state. Used by the
 * inline profile-form card.
 */

import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  writeOnboardingProfileFields,
  WRITABLE_PROFILE_FIELDS,
  type OnboardingProfileField,
} from "@/lib/onboarding/profile-write";

export async function POST(req: Request) {
  try {
    const { companyId } = await getSessionCompanyContext();
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const input: Partial<Record<OnboardingProfileField, unknown>> = {};
    for (const field of WRITABLE_PROFILE_FIELDS) {
      if (field in body) input[field] = body[field];
    }

    const written = await writeOnboardingProfileFields(companyId, input);
    return NextResponse.json({ status: "ok", written });
  } catch (error) {
    return handleApiError(error);
  }
}
