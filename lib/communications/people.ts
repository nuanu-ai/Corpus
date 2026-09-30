import type {
  CommunicationContact,
  CommunicationMessageRow,
} from "@/lib/communications/types";

type MutableSenderContact = {
  identityKey: string;
  provider: string;
  providerIdentity: string | null;
  names: Map<string, number>;
  emails: Set<string>;
  telegramHandles: Set<string>;
  sourceMessageIds: Set<string>;
  lastInteraction: string;
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeText(value);
  if (!normalized || normalized.toLowerCase() === "you") return null;
  return normalized;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeText(value).toLowerCase();
  return normalized.includes("@") ? normalized : null;
}

function normalizeTelegramHandle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeText(value).replace(/^@+/, "");
  return normalized.length > 0 ? normalized : null;
}

function isOutgoingMessage(message: CommunicationMessageRow): boolean {
  return message.rawPayload?.out === true || normalizeName(message.senderName) === null;
}

function buildIdentity(message: CommunicationMessageRow): {
  identityKey: string;
  providerIdentity: string | null;
  email: string | null;
  telegramHandle: string | null;
} | null {
  const email = normalizeEmail(message.senderAddress);
  if (email) {
    return {
      identityKey: `${message.provider}:email:${email}`,
      providerIdentity: email,
      email,
      telegramHandle: null,
    };
  }

  if (message.provider === "telegram") {
    const senderId =
      typeof message.senderId === "string" && message.senderId.trim().length > 0
        ? message.senderId.trim()
        : null;
    const telegramHandle = normalizeTelegramHandle(message.senderAddress);
    if (senderId) {
      return {
        identityKey: `telegram:id:${senderId}`,
        providerIdentity: senderId,
        email: null,
        telegramHandle,
      };
    }
    if (telegramHandle) {
      return {
        identityKey: `telegram:handle:${telegramHandle.toLowerCase()}`,
        providerIdentity: telegramHandle,
        email: null,
        telegramHandle,
      };
    }
  }

  const senderName = normalizeName(message.senderName);
  if (!senderName) return null;

  return {
    identityKey: `${message.provider}:name:${senderName.toLowerCase()}`,
    providerIdentity: senderName,
    email: null,
    telegramHandle: null,
  };
}

function pickDisplayName(names: Map<string, number>): string | null {
  const ranked = Array.from(names.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
  return ranked[0]?.[0] ?? null;
}

export function deriveSenderContacts(
  messages: CommunicationMessageRow[],
): CommunicationContact[] {
  const contacts = new Map<string, MutableSenderContact>();

  for (const message of messages) {
    if (isOutgoingMessage(message)) continue;

    const identity = buildIdentity(message);
    const senderName = normalizeName(message.senderName);
    if (!identity || !senderName) continue;

    const current =
      contacts.get(identity.identityKey) ??
      ({
        identityKey: identity.identityKey,
        provider: message.provider,
        providerIdentity: identity.providerIdentity,
        names: new Map<string, number>(),
        emails: new Set<string>(),
        telegramHandles: new Set<string>(),
        sourceMessageIds: new Set<string>(),
        lastInteraction: message.receivedAt,
      } satisfies MutableSenderContact);

    current.names.set(senderName, (current.names.get(senderName) ?? 0) + 1);
    if (identity.email) current.emails.add(identity.email);
    if (identity.telegramHandle) current.telegramHandles.add(identity.telegramHandle);
    current.sourceMessageIds.add(message.id);
    if (new Date(message.receivedAt).getTime() >= new Date(current.lastInteraction).getTime()) {
      current.lastInteraction = message.receivedAt;
    }

    contacts.set(identity.identityKey, current);
  }

  return Array.from(contacts.values())
    .map((contact): CommunicationContact | null => {
      const name = pickDisplayName(contact.names);
      if (!name) return null;

      const email = Array.from(contact.emails)[0] ?? undefined;
      const telegramHandle = Array.from(contact.telegramHandles)[0] ?? undefined;

      return {
        name,
        displayName: name,
        role: "other",
        organizationName: undefined,
        email,
        phone: undefined,
        telegramHandle,
        notes: undefined,
        tags: [contact.provider],
        sourceMessageIds: Array.from(contact.sourceMessageIds),
        confidence: email || telegramHandle ? 1 : 0.8,
      };
    })
    .filter((contact): contact is CommunicationContact => contact !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
