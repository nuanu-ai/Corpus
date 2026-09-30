import { coerceTelegramConnectionMetadata } from "@/lib/connectors/telegram";

export interface TelegramSyncTargetCandidate {
  id: string;
  companyId: string;
  tenantKind: string | null;
  metadata: unknown;
}

export function isTelegramCompanySyncTenant(tenantKind: string | null | undefined): boolean {
  return tenantKind === "company";
}

export function selectTelegramSyncTargets(
  candidates: TelegramSyncTargetCandidate[],
): TelegramSyncTargetCandidate[] {
  return candidates.filter((connection) => {
    if (!isTelegramCompanySyncTenant(connection.tenantKind)) return false;
    const metadata = coerceTelegramConnectionMetadata(connection.metadata);
    return metadata.syncedChats.some((chat) => chat.enabled);
  });
}
