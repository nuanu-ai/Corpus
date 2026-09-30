import { NextRequest, NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getTransactions } from "@/lib/queries/transactions";

export function parseTransactionDateParam(value: string | null): Date | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const [yearStr, monthStr, dayStr] = trimmed.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const { companyId } = auth;
    const params = new URL(request.url).searchParams;

    const page = params.get("page") ? Math.max(1, Number(params.get("page"))) : undefined;
    const rawPageSize = params.get("pageSize") ? Number(params.get("pageSize")) : undefined;
    const pageSize = rawPageSize ? Math.min(Math.max(1, rawPageSize), 200) : undefined;
    const category = params.get("category") ?? undefined;
    const type = params.get("type") as "credit" | "debit" | undefined;
    const fromParam = params.get("from");
    const toParam = params.get("to");
    const from = parseTransactionDateParam(fromParam);
    if (fromParam && !from) {
      return NextResponse.json({ error: "Invalid from date. Expected YYYY-MM-DD." }, { status: 400 });
    }
    const to = parseTransactionDateParam(toParam);
    if (toParam && !to) {
      return NextResponse.json({ error: "Invalid to date. Expected YYYY-MM-DD." }, { status: 400 });
    }
    const search = params.get("search") ?? undefined;

    const result = await getTransactions(companyId, {
      page,
      pageSize,
      category,
      type: type === "credit" || type === "debit" ? type : undefined,
      from: from ?? undefined,
      to: to ?? undefined,
      search,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
