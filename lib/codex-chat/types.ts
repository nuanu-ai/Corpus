export const CODEX_CHAT_EXECUTOR = "codex_chat" as const;
export const CONSULTANT_EXECUTOR = "consultant" as const;

export type ChatThreadExecutor =
  | typeof CONSULTANT_EXECUTOR
  | typeof CODEX_CHAT_EXECUTOR;

export const CODEX_CHAT_AUTH_MODES = ["chatgpt_login", "api_key"] as const;
export type CodexChatAuthMode = (typeof CODEX_CHAT_AUTH_MODES)[number];

export const CODEX_CHAT_AUTH_STATUSES = [
  "pending",
  "ready",
  "degraded",
  "disconnected",
] as const;
export type CodexChatAuthStatus = (typeof CODEX_CHAT_AUTH_STATUSES)[number];

export const CODEX_CHAT_AUTH_CHALLENGE_STATUSES = [
  "pending",
  "awaiting_user",
  "completed",
  "failed",
  "expired",
] as const;
export type CodexChatAuthChallengeStatus =
  (typeof CODEX_CHAT_AUTH_CHALLENGE_STATUSES)[number];

export const CODEX_CHAT_AUTH_CHALLENGE_TYPES = ["device_login"] as const;
export type CodexChatAuthChallengeType =
  (typeof CODEX_CHAT_AUTH_CHALLENGE_TYPES)[number];

export function isCodexChatAuthMode(value: unknown): value is CodexChatAuthMode {
  return typeof value === "string" && CODEX_CHAT_AUTH_MODES.includes(value as CodexChatAuthMode);
}

export function isChatThreadExecutor(value: unknown): value is ChatThreadExecutor {
  return value === CONSULTANT_EXECUTOR || value === CODEX_CHAT_EXECUTOR;
}
