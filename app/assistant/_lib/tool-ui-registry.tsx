"use client";

// Tool UI registrations for Company-DB, currency, and navigation tools.
// Mirrors the structure of `_lib/artifact-tool-ui.tsx` and `_lib/approval-tool-ui.tsx`.
//
// Each `makeAssistantToolUI` call registers a render override scoped to a
// specific backend tool name. When that tool emits its result, the registered
// renderer runs; otherwise the ToolFallback in components/assistant-ui/thread.tsx
// takes over.
//
// Backend tool names sourced from app/api/chat/route.ts:
// - company_db_result / company_db_search  -> query_financial_data, query_company_data,
//                                              search_financial_data, search_company_data
// - currency_conversion                     -> convert_currency_amount
// - switch_view                             -> show_pnl, show_expenses, show_balance_sheet,
//                                              show_cash_flow, show_plan_vs_actual,
//                                              show_accounts, show_documents

import { makeAssistantToolUI } from "@assistant-ui/react";

import { CompanyDbResultCard } from "@/components/assistant-ui/tool-ui/company-db-result-card";
import { CurrencyConversionCard } from "@/components/assistant-ui/tool-ui/currency-conversion-card";
import { NavigationHint } from "@/components/assistant-ui/tool-ui/navigation-hint";

import { isRecord } from "./normalizers";

type AnyResult = unknown;

function CompanyDbRender({ result }: { result: AnyResult }) {
  if (!isRecord(result)) return null;
  return <CompanyDbResultCard result={result} />;
}

function CurrencyRender({ result }: { result: AnyResult }) {
  if (!isRecord(result)) return null;
  return <CurrencyConversionCard result={result} />;
}

function NavigationRender({ result }: { result: AnyResult }) {
  if (!isRecord(result)) return null;
  return <NavigationHint result={result} />;
}

// Company-DB query/search tools ------------------------------------------------

const QueryFinancialDataToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "query_financial_data",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <CompanyDbRender result={result} />;
  },
});

const QueryCompanyDataToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "query_company_data",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <CompanyDbRender result={result} />;
  },
});

const SearchFinancialDataToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "search_financial_data",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <CompanyDbRender result={result} />;
  },
});

const SearchCompanyDataToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "search_company_data",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <CompanyDbRender result={result} />;
  },
});

// Currency conversion tool -----------------------------------------------------

const ConvertCurrencyAmountToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "convert_currency_amount",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <CurrencyRender result={result} />;
  },
});

// Navigation (switch_view) tools ----------------------------------------------

const ShowPnlToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: "show_pnl",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <NavigationRender result={result} />;
  },
});

const ShowExpensesToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "show_expenses",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <NavigationRender result={result} />;
  },
});

const ShowBalanceSheetToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "show_balance_sheet",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <NavigationRender result={result} />;
  },
});

const ShowCashFlowToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "show_cash_flow",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <NavigationRender result={result} />;
  },
});

const ShowPlanVsActualToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "show_plan_vs_actual",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <NavigationRender result={result} />;
  },
});

const ShowAccountsToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "show_accounts",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <NavigationRender result={result} />;
  },
});

const ShowDocumentsToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "show_documents",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <NavigationRender result={result} />;
  },
});

/**
 * Mount this once inside the AssistantRuntimeProvider tree. It registers all
 * Company-DB + currency + navigation tool UIs with the runtime (side-effect
 * only; renders nothing visible).
 */
export function CompanyDbToolUIs() {
  return (
    <>
      <QueryFinancialDataToolUI />
      <QueryCompanyDataToolUI />
      <SearchFinancialDataToolUI />
      <SearchCompanyDataToolUI />
      <ConvertCurrencyAmountToolUI />
      <ShowPnlToolUI />
      <ShowExpensesToolUI />
      <ShowBalanceSheetToolUI />
      <ShowCashFlowToolUI />
      <ShowPlanVsActualToolUI />
      <ShowAccountsToolUI />
      <ShowDocumentsToolUI />
    </>
  );
}
