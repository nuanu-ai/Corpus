export type AgentSafeAuthMethod = "session" | "api_key";
export type AgentSafeEntityView = "full" | "summary";

function normalizePositiveInteger(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

export function normalizeRequestedEntityView(
  value: string | null | undefined,
): AgentSafeEntityView | undefined {
  return value === "summary" || value === "full" ? value : undefined;
}

export function resolveAgentSafeEntityView(
  authMethod: AgentSafeAuthMethod,
  requestedView: string | null | undefined,
): AgentSafeEntityView | undefined {
  void authMethod;
  return normalizeRequestedEntityView(requestedView);
}

export function resolveAgentSafeQueryLimit(
  authMethod: AgentSafeAuthMethod,
  requestedLimit: number | null | undefined,
): number | undefined {
  void authMethod;
  return normalizePositiveInteger(requestedLimit);
}

export function resolveAgentSafeSearchLimit(
  authMethod: AgentSafeAuthMethod,
  requestedLimit: number | null | undefined,
): number | undefined {
  void authMethod;
  return normalizePositiveInteger(requestedLimit);
}

export function resolveAgentSafeDocumentLimit(
  authMethod: AgentSafeAuthMethod,
  requestedLimit: number | null | undefined,
): number | undefined {
  void authMethod;
  return normalizePositiveInteger(requestedLimit);
}

export function resolveAgentSafeFilePreviewChars(
  authMethod: AgentSafeAuthMethod,
  requestedChars: number | null | undefined,
): number | undefined {
  void authMethod;
  return normalizePositiveInteger(requestedChars);
}

export function truncateAgentFilePreview(
  content: string,
  authMethod: AgentSafeAuthMethod,
  options?: {
    full?: boolean;
    maxChars?: number | null;
  },
): {
  content: string;
  truncated: boolean;
  originalLength: number;
  returnedLength: number;
} {
  const originalLength = content.length;
  if (options?.full) {
    return {
      content,
      truncated: false,
      originalLength,
      returnedLength: originalLength,
    };
  }

  const maxChars = resolveAgentSafeFilePreviewChars(authMethod, options?.maxChars);
  if (!maxChars || originalLength <= maxChars) {
    return {
      content,
      truncated: false,
      originalLength,
      returnedLength: originalLength,
    };
  }

  return {
    content: content.slice(0, maxChars),
    truncated: true,
    originalLength,
    returnedLength: maxChars,
  };
}
