import type { BankBalanceSnapshot } from "./bank-balance-parser";

export interface BankBalanceStagingRow {
  companySlug: string;
  source: string;
  externalId: string;
  payload: Record<string, unknown>;
  status: "pending";
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function buildBankBalanceExternalId(snapshot: BankBalanceSnapshot): string {
  return `bank_balance_snapshot:${slugify(snapshot.asOfDate)}`;
}

export function buildBankBalanceStagingRows(input: {
  companySlug: string;
  documentId: string;
  sourceDocumentName: string;
  snapshot: BankBalanceSnapshot | null | undefined;
}): BankBalanceStagingRow[] {
  const { companySlug, documentId, sourceDocumentName, snapshot } = input;
  if (!snapshot || snapshot.accountCount === 0) return [];

  return [
    {
      companySlug,
      source: "bank-balance-import:snapshot",
      externalId: buildBankBalanceExternalId(snapshot),
      payload: {
        documentId,
        document_id: documentId,
        source_document_name: sourceDocumentName,
        snapshot,
      },
      status: "pending",
    },
  ];
}
