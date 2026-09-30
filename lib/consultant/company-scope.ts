import type { CompanyMembership } from "@/lib/db/tenant";

const COMPANY_SCOPE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "club",
  "co",
  "company",
  "corp",
  "for",
  "inc",
  "llc",
  "ltd",
  "of",
  "project",
  "pt",
  "report",
  "residence",
  "the",
  "to",
]);

export type CompanyScopeMatch = CompanyMembership & {
  score: number;
  matchedLabel: string;
  isActiveCompany: boolean;
  matchReason: "exact" | "phrase" | "all_tokens" | "partial_tokens";
};

function normalizeCompanyScopeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeCompanyScopeText(value: string): string[] {
  return normalizeCompanyScopeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !COMPANY_SCOPE_STOPWORDS.has(token));
}

function labelsForMembership(membership: CompanyMembership): string[] {
  return Array.from(
    new Set(
      [
        membership.companyName,
        membership.companySlug ?? "",
        (membership.companySlug ?? "").replace(/-/g, " "),
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function scoreCompanyLabel(input: {
  normalizedQuery: string;
  queryTokens: Set<string>;
  label: string;
}): Omit<CompanyScopeMatch, keyof CompanyMembership | "isActiveCompany"> | null {
  const normalizedLabel = normalizeCompanyScopeText(input.label);
  if (!normalizedLabel) return null;

  if (input.normalizedQuery === normalizedLabel) {
    return {
      score: 120 + Math.min(normalizedLabel.length, 30),
      matchedLabel: input.label,
      matchReason: "exact",
    };
  }

  if (input.normalizedQuery.includes(normalizedLabel)) {
    return {
      score: 95 + Math.min(normalizedLabel.length, 30),
      matchedLabel: input.label,
      matchReason: "phrase",
    };
  }

  const labelTokens = tokenizeCompanyScopeText(input.label);
  if (labelTokens.length === 0) return null;

  const matchedTokens = labelTokens.filter((token) => input.queryTokens.has(token));
  if (matchedTokens.length === 0) return null;

  if (matchedTokens.length === labelTokens.length) {
    return {
      score: 70 + matchedTokens.length * 10,
      matchedLabel: input.label,
      matchReason: "all_tokens",
    };
  }

  return {
    score: 35 + matchedTokens.length * 10,
    matchedLabel: input.label,
    matchReason: "partial_tokens",
  };
}

export function rankCompanyScopeMatches(input: {
  query: string;
  targetCompanyName?: string | null;
  memberships: CompanyMembership[];
  activeCompanyId?: string | null;
  limit?: number;
}): {
  matches: CompanyScopeMatch[];
  ambiguous: boolean;
  topMatch: CompanyScopeMatch | null;
} {
  const combinedQuery = [input.targetCompanyName, input.query]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const normalizedQuery = normalizeCompanyScopeText(combinedQuery);
  const queryTokens = new Set(tokenizeCompanyScopeText(combinedQuery));
  if (!normalizedQuery || queryTokens.size === 0) {
    return { matches: [], ambiguous: false, topMatch: null };
  }

  const matches = input.memberships
    .map((membership) => {
      const best = labelsForMembership(membership)
        .map((label) => scoreCompanyLabel({ normalizedQuery, queryTokens, label }))
        .filter((value): value is NonNullable<typeof value> => value !== null)
        .sort((left, right) => right.score - left.score)[0];

      if (!best) return null;

      return {
        ...membership,
        ...best,
        isActiveCompany: membership.companyId === input.activeCompanyId,
      };
    })
    .filter((value): value is CompanyScopeMatch => value !== null && value.score >= 45)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.companyName.localeCompare(right.companyName);
    })
    .slice(0, input.limit ?? 5);

  const topMatch = matches[0] ?? null;
  const ambiguous =
    matches.length > 1 && topMatch !== null && matches[1].score >= topMatch.score - 10;

  return { matches, ambiguous, topMatch };
}
