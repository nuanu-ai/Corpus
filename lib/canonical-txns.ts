import { sql } from "drizzle-orm";
import { canonicalTxns } from "@/lib/db/schema";
import { convertToUsd } from "@/lib/fx";

interface CanonicalTxnMoneyColumns {
  amountUsd: unknown;
  currency: unknown;
  fxRate: unknown;
}

export interface CanonicalTxnWriteInput {
  companyId: string;
  rawEventId: string;
  connectionId: string | null;
  date: Date;
  amount: string | number;
  currency: string;
  description: string | null;
  merchantName: string | null;
  merchantMcc?: string | null;
  sourceRef: string;
  type: string;
  status: string;
  metadata: Record<string, unknown>;
}

function formatNumeric(value: number, scale: number = 2): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot format non-finite numeric value: ${value}`);
  }
  return value.toFixed(scale).replace(/\.?0+$/, "");
}

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid canonical transaction amount: ${value}`);
  }
  return Math.abs(parsed);
}

function buildMetadataWithFxStatus(
  metadata: Record<string, unknown>,
  input: { amountUsd: number | null; currency: string; date: Date },
): Record<string, unknown> {
  if (input.amountUsd !== null || input.currency === "USD") {
    return metadata;
  }

  return {
    ...metadata,
    amountUsdUnavailableReason: "missing_fx_rate",
    fxConversion: {
      status: "missing_rate",
      sourceCurrency: input.currency,
      targetCurrency: "USD",
      rateDate: input.date.toISOString(),
    },
  };
}

export async function buildCanonicalTxnWriteValues(
  input: CanonicalTxnWriteInput,
) {
  const amount = parseAmount(input.amount);
  const date = input.date instanceof Date ? input.date : new Date(input.date);
  const currency = input.currency.toUpperCase();
  const { amountUsd, fxRate } = await convertToUsd(amount, currency, date);
  const metadata = buildMetadataWithFxStatus(input.metadata, {
    amountUsd,
    currency,
    date,
  });

  return {
    companyId: input.companyId,
    rawEventId: input.rawEventId,
    connectionId: input.connectionId,
    date,
    amount: formatNumeric(amount),
    currency,
    amountUsd: amountUsd === null ? "0" : formatNumeric(amountUsd),
    fxRate: fxRate === null ? null : formatNumeric(fxRate, 6),
    description: input.description,
    merchantName: input.merchantName,
    merchantMcc: input.merchantMcc ?? null,
    sourceRef: input.sourceRef,
    type: input.type,
    status: input.status,
    metadata,
  };
}

export function trustedAmountUsdSql(
  columns: CanonicalTxnMoneyColumns = canonicalTxns,
) {
  return sql<string>`case when ${columns.currency} = 'USD' or ${columns.fxRate} is not null then ${columns.amountUsd} else 0 end`;
}

export function trustedAmountUsdOrNullSql(
  columns: CanonicalTxnMoneyColumns = canonicalTxns,
) {
  return sql<string | null>`case when ${columns.currency} = 'USD' or ${columns.fxRate} is not null then ${columns.amountUsd} else null end`;
}
