import { runQmd } from "./qmd-runner";
import type { CategorizationResult } from "./rules-engine";

interface QmdResult {
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Extract the category from a QMD result text.
 * Document format: "{merchantName} {description} {amount} | {category}"
 * The pipe delimiter supports multi-word categories like "Cloud Infrastructure".
 */
function extractCategory(text: string): string | null {
  const pipeIndex = text.lastIndexOf("|");
  if (pipeIndex === -1) return null;
  const category = text.slice(pipeIndex + 1).trim();
  return category || null;
}

/**
 * Categorize a transaction using QMD hybrid search (BM25 + vector + LLM re-ranking).
 * Returns null if QMD is not installed, fails, or no strong match is found.
 */
export async function categorizeWithQmd(
  txn: {
    merchantName: string | null;
    description: string | null;
    amount: number;
  },
  companyId: string
): Promise<CategorizationResult | null> {
  try {
    const queryParts = [
      txn.merchantName ?? "",
      txn.description ?? "",
      String(txn.amount),
    ]
      .filter(Boolean)
      .join(" ");

    const stdout = await runQmd([
      "query",
      "--collection",
      `transactions/${companyId}`,
      "--top",
      "5",
      "--format",
      "json",
      queryParts,
    ]);

    const results: QmdResult[] = JSON.parse(stdout);

    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    const topResult = results[0];

    if (topResult.score <= 0.8) {
      return null;
    }

    const category = extractCategory(topResult.text);
    if (!category) {
      return null;
    }

    // Check consensus among top 3 results
    const top3 = results.slice(0, 3);
    const top3Categories = top3
      .map((r) => extractCategory(r.text))
      .filter(Boolean);
    const allAgree =
      top3Categories.length >= 2 &&
      top3Categories.every((c) => c === category);

    if (!allAgree) {
      return null;
    }

    return {
      category,
      confidence: topResult.score,
      method: "qmd",
      reasoning: `QMD hybrid search: top ${top3Categories.length} results agree on "${category}" (score: ${topResult.score.toFixed(3)})`,
    };
  } catch {
    // Graceful degradation: QMD not installed or any other error
    return null;
  }
}
