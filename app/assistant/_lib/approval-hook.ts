"use client";

import { useCallback, useState } from "react";

import { normalizeApproval } from "./normalizers";
import type { StoredChatApproval } from "./types";

// Ported from app/dashboard/_components/chat-panel.tsx (~1461-1546).
// Exposes PATCH /api/chat/threads/:id/approvals/:approvalId with in-flight
// tracking so the card can disable buttons while the request is pending.
export interface UseResolveApprovalResult {
  resolve: (
    approvalId: string,
    status: "approved" | "rejected",
  ) => Promise<StoredChatApproval>;
  isResolving: (approvalId: string) => boolean;
}

export function useResolveApproval(
  threadId: string | null,
  threadsApi: string,
): UseResolveApprovalResult {
  const [inFlight, setInFlight] = useState<string[]>([]);

  const resolve = useCallback(
    async (
      approvalId: string,
      status: "approved" | "rejected",
    ): Promise<StoredChatApproval> => {
      if (!threadId) {
        throw new Error(
          "Thread is not yet persisted. Send a message before approving.",
        );
      }

      setInFlight((prev) =>
        prev.includes(approvalId) ? prev : prev.concat(approvalId),
      );

      try {
        const response = await fetch(
          `${threadsApi}/${encodeURIComponent(threadId)}/approvals/${encodeURIComponent(
            approvalId,
          )}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          },
        );

        if (!response.ok) {
          let message = `Failed to ${status === "approved" ? "approve" : "reject"} request.`;
          try {
            const errBody = (await response.json()) as { error?: unknown };
            if (typeof errBody?.error === "string" && errBody.error.trim()) {
              message = errBody.error;
            }
          } catch {
            // ignore non-JSON error bodies
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as unknown;
        const normalized = normalizeApproval(payload);
        if (!normalized) {
          throw new Error("Invalid approval payload from server.");
        }
        return normalized;
      } finally {
        setInFlight((prev) => prev.filter((value) => value !== approvalId));
      }
    },
    [threadsApi, threadId],
  );

  const isResolving = useCallback(
    (approvalId: string) => inFlight.includes(approvalId),
    [inFlight],
  );

  return { resolve, isResolving };
}
