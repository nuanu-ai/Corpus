import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  getCodexChatAuthChallengeById,
  getLatestCodexChatAuthChallenge,
  getLatestCodexChatAuthProfile,
} from "@/lib/codex-chat/auth-store";

export async function GET(req: NextRequest) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const url = new URL(req.url);
    const challengeId = url.searchParams.get("challengeId")?.trim() || null;

    const activeProfile = await getLatestCodexChatAuthProfile({ companyId, userId });
    if (!activeProfile) {
      return NextResponse.json({
        ok: false,
        ready: false,
        activeProfile: null,
        challenge: null,
      });
    }

    const challenge = challengeId
      ? await getCodexChatAuthChallengeById({
          companyId,
          userId,
          challengeId,
        })
      : await getLatestCodexChatAuthChallenge({
          companyId,
          userId,
          authProfileId: activeProfile.id,
        });

    return NextResponse.json({
      ok: true,
      ready: activeProfile.status === "ready",
      activeProfile,
      challenge,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
