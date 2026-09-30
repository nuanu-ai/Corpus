export const EXECUTING_APPROVAL_STALE_MS = 15 * 60 * 1000;

export function isChatApprovalExecutionStale(input: {
  updatedAt: Date;
  now?: Date;
  timeoutMs?: number;
}) {
  const now = input.now ?? new Date();
  const timeoutMs = input.timeoutMs ?? EXECUTING_APPROVAL_STALE_MS;
  return input.updatedAt.getTime() <= now.getTime() - timeoutMs;
}
