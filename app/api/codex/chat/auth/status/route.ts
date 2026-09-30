import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  getLatestCodexChatAuthChallenge,
  getLatestCodexChatAuthProfile,
  listCodexChatAuthProfiles,
} from "@/lib/codex-chat/auth-store";

export async function GET() {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const [activeProfile, profiles] = await Promise.all([
      getLatestCodexChatAuthProfile({ companyId, userId }),
      listCodexChatAuthProfiles({ companyId, userId }),
    ]);
    const activeChallenge = activeProfile
      ? await getLatestCodexChatAuthChallenge({
          companyId,
          userId,
          authProfileId: activeProfile.id,
        })
      : null;

    return NextResponse.json({
      runtime: "codex_chat",
      companyId,
      userId,
      ready: activeProfile?.status === "ready",
      activeProfile,
      profiles,
      activeChallenge,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
