const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const URL_RE = /(https?:\/\/[^\s'"`<>()[\]{};,!?]+[^\s'"`<>()[\]{};,!.?:]+)/gi;
const CODEX_DEVICE_CODE_RE = /\b([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\b/;

export const CODEX_CHAT_DEVICE_AUTH_MAX_LIFETIME_MS = 20 * 60 * 1000;
export const CODEX_CHAT_DEVICE_AUTH_HINT_WAIT_MS = 12_000;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_RE, "");
}

export function extractCodexLoginUrl(text: string): string | null {
  const matches = text.match(URL_RE);
  if (!matches || matches.length === 0) return null;

  for (const rawUrl of matches) {
    const cleaned = rawUrl.replace(/[\])}.!,?;:'"]+$/g, "");
    if (cleaned.includes("auth.openai.com") || cleaned.includes("/codex/device")) {
      return cleaned;
    }
  }

  return matches[0]?.replace(/[\])}.!,?;:'"]+$/g, "") ?? null;
}

export function extractCodexDeviceCode(text: string): string | null {
  const match = stripAnsi(text).match(CODEX_DEVICE_CODE_RE);
  return match?.[1] ?? null;
}
