import { runQmd } from "./qmd-runner";

/**
 * Index a categorized transaction into QMD for future RAG lookups.
 * Returns true on success, false on failure (graceful degradation).
 */
export async function indexTransaction(
  txn: {
    merchantName: string | null;
    description: string | null;
    amount: number;
    category: string;
  },
  companyId: string
): Promise<boolean> {
  try {
    const textParts = [
      txn.merchantName ?? "",
      txn.description ?? "",
      String(txn.amount),
    ]
      .filter(Boolean)
      .join(" ");
    const documentParts = `${textParts} | ${txn.category}`;

    await runQmd([
      "add",
      "--collection",
      `transactions/${companyId}`,
      "--text",
      documentParts,
    ]);

    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the QMD collection exists for a given company.
 * Creates it if it doesn't exist. Returns true on success, false on failure.
 */
export async function ensureCollection(companyId: string): Promise<boolean> {
  try {
    await runQmd(["collection", "create", `transactions/${companyId}`]);
    return true;
  } catch {
    return false;
  }
}
