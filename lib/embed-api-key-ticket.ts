import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const EMBED_API_KEY_TICKET_VERSION = 1;
const DEFAULT_TTL_SECONDS = 60;

type EmbedApiKeyTicketPayload = {
  v: number;
  jti: string;
  userId: string;
  companyId: string | null;
  targetPath: string | null;
  returnUrl: string | null;
  exp: number;
};

function getEmbedTicketSecret(): string {
  const secret = process.env.CORPUS_EMBED_API_KEY_TICKET_SECRET?.trim();
  if (!secret) {
    throw new Error("CORPUS_EMBED_API_KEY_TICKET_SECRET is required");
  }
  return secret;
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getEmbedTicketSecret()).update(encodedPayload).digest("base64url");
}

export function issueEmbedApiKeyTicket(input: {
  userId: string;
  companyId: string | null;
  targetPath?: string | null;
  returnUrl?: string | null;
  ttlSeconds?: number;
  ticketId?: string;
}): string {
  const ttlSeconds = Math.max(5, input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload: EmbedApiKeyTicketPayload = {
    v: EMBED_API_KEY_TICKET_VERSION,
    jti: input.ticketId ?? randomUUID(),
    userId: input.userId,
    companyId: input.companyId,
    targetPath: input.targetPath ?? null,
    returnUrl: input.returnUrl ?? null,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyEmbedApiKeyTicket(ticket: string): EmbedApiKeyTicketPayload {
  const [encodedPayload, signature] = ticket.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid embed ticket");
  }

  const expectedSignature = signPayload(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid embed ticket signature");
  }

  let payload: EmbedApiKeyTicketPayload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload)) as EmbedApiKeyTicketPayload;
  } catch {
    throw new Error("Invalid embed ticket payload");
  }

  if (payload.v !== EMBED_API_KEY_TICKET_VERSION) {
    throw new Error("Unsupported embed ticket version");
  }
  if (!payload.jti || typeof payload.jti !== "string") {
    throw new Error("Invalid embed ticket id");
  }
  if (!payload.userId || typeof payload.userId !== "string") {
    throw new Error("Invalid embed ticket user");
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Embed ticket expired");
  }
  if (payload.companyId !== null && typeof payload.companyId !== "string") {
    throw new Error("Invalid embed ticket company");
  }
  if (payload.targetPath !== null && typeof payload.targetPath !== "string") {
    throw new Error("Invalid embed ticket target path");
  }
  if (payload.returnUrl !== null && typeof payload.returnUrl !== "string") {
    throw new Error("Invalid embed ticket return url");
  }

  return payload;
}
