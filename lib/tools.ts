import { tool } from "ai";
import { z } from "zod";

import { getDashboardRouteForView } from "./dashboard-navigation";

export const cfoTools = {
  show_pnl: tool({
    description: "Show P&L (Profit & Loss) report on the dashboard",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        view: "pnl" as const,
        route: getDashboardRouteForView("pnl"),
        success: true,
      };
    },
  }),

  show_expenses: tool({
    description: "Show expense breakdown on the dashboard with anomaly highlights",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        view: "expenses" as const,
        route: getDashboardRouteForView("expenses"),
        success: true,
      };
    },
  }),

  show_balance_sheet: tool({
    description: "Show balance sheet analysis on the dashboard",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        view: "balance-sheet" as const,
        route: getDashboardRouteForView("balance-sheet"),
        success: true,
      };
    },
  }),

  show_cash_flow: tool({
    description: "Show cash flow analysis on the dashboard",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        view: "cash-flow" as const,
        route: getDashboardRouteForView("cash-flow"),
        success: true,
      };
    },
  }),

  show_plan_vs_actual: tool({
    description: "Show plan versus actual performance on the dashboard",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        view: "plan-vs-actual" as const,
        route: getDashboardRouteForView("plan-vs-actual"),
        success: true,
      };
    },
  }),

  show_accounts: tool({
    description: "Show account balances across all connected accounts on the dashboard",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        view: "accounts" as const,
        route: getDashboardRouteForView("accounts"),
        success: true,
      };
    },
  }),

  show_documents: tool({
    description:
      "Show Documents — document processing queue, transaction category review, and document history. Use when user asks about uploaded documents, OCR processing, or transaction categorization review.",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        view: "documents" as const,
        route: getDashboardRouteForView("documents"),
        success: true,
      };
    },
  }),

  compare_jurisdictions: tool({
    description: "Open the jurisdiction comparison navigator to compare tax jurisdictions",
    inputSchema: z.object({}),
    execute: async () => {
      return { action: "navigate" as const, destination: "jurisdictions" as const, success: true };
    },
  }),

  show_alert_details: tool({
    description: "Show details of a specific financial alert",
    inputSchema: z.object({
      alertId: z.string().describe("The ID of the alert to show details for"),
    }),
    execute: async ({ alertId }) => {
      return { alertId, success: true };
    },
  }),

  query_financial_data: tool({
    description: "Query verified financial records from Company-DB by domain and type",
    inputSchema: z.object({
      domain: z.string().describe("Financial domain (banking, expenses, invoices, payroll, finance)"),
      type: z.string().optional().describe("Entity type filter"),
      limit: z.number().optional().default(20).describe("Max results"),
    }),
    execute: async ({ domain, type, limit }) => {
      return { action: "company_db_result" as const, domain, type, limit, success: true };
    },
  }),

  search_financial_data: tool({
    description: "Full-text search across all financial records in Company-DB",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
    }),
    execute: async ({ query }) => {
      return { action: "company_db_search" as const, query, success: true };
    },
  }),
};

export type CFOToolName = keyof typeof cfoTools;
export type { DashboardView } from "./dashboard-navigation";
