import { NextResponse } from "next/server";

import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { getCodexAuthHealth } from "@/lib/admin/codex-auth-health";
import { getCodexQueueStatus } from "@/lib/codex-worker/queue-status";

export async function GET() {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.read");

    const [codexAuth, queue] = await Promise.all([
      getCodexAuthHealth(),
      getCodexQueueStatus(auth.companyId),
    ]);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      auth: {
        mode: codexAuth.chatgpt.authMode,
        ready: codexAuth.chatgpt.ready,
        degraded: codexAuth.chatgpt.degraded,
        reason: codexAuth.chatgpt.reason,
        lastReadyAt: codexAuth.chatgpt.lastReadyAt,
        lastFailureAt: codexAuth.chatgpt.lastFailureAt,
        effectiveWorkers: codexAuth.chatgpt.effectiveWorkers,
        requestedWorkers: codexAuth.chatgpt.requestedWorkers,
        configuredSlots: codexAuth.chatgpt.configuredSlots,
        readySlots: codexAuth.chatgpt.readySlots,
        slots: codexAuth.chatgpt.slots,
      },
      queue,
      routing: {
        pool: "chatgpt",
        fallbackToApiKeyPool: false,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
