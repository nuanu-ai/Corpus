import type { NextRequest } from "next/server";

type TicketRedemptionNamespace = "embed_api_key";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const rateLimitState = new Map<string, number[]>();

function nowMs() {
  return Date.now();
}

function clientAddress(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  return "unknown";
}

export function checkTicketRedemptionRateLimit(
  request: NextRequest,
  namespace: TicketRedemptionNamespace,
): boolean {
  const key = `${namespace}:${clientAddress(request)}`;
  const currentTime = nowMs();
  const windowStart = currentTime - WINDOW_MS;
  const previous = rateLimitState.get(key) ?? [];
  const recent = previous.filter((timestamp) => timestamp > windowStart);

  if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
    rateLimitState.set(key, recent);
    return false;
  }

  recent.push(currentTime);
  rateLimitState.set(key, recent);
  return true;
}

export function resetTicketRedemptionRateLimits() {
  rateLimitState.clear();
}
