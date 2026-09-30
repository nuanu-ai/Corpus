export const DEFAULT_COMPANY_CHAT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_COMPANY_CHAT_MAX_OUTPUT_TOKENS = 8192;

export function getCompanyChatModel(): string {
  return (
    process.env.CORPUS_CHAT_MODEL?.trim() ||
    process.env.CORPUS_CHAT_MODEL?.trim() ||
    DEFAULT_COMPANY_CHAT_MODEL
  );
}

export function getCompanyChatMaxOutputTokens(): number {
  const raw =
    process.env.CORPUS_CHAT_MAX_OUTPUT_TOKENS?.trim() ||
    process.env.CORPUS_CHAT_MAX_OUTPUT_TOKENS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_COMPANY_CHAT_MAX_OUTPUT_TOKENS;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_COMPANY_CHAT_MAX_OUTPUT_TOKENS;
  }
  return Math.min(Math.max(parsed, 1024), 32000);
}
