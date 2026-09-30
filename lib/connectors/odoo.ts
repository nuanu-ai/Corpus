/**
 * Typed Odoo fetch functions for all syncable models.
 *
 * Each function takes an `Executor` (the `executeMethod` from OdooMcpClient)
 * and an optional `since` date for incremental sync.
 */

import type { OdooMcpClient } from "./odoo-mcp-client";

// ── Executor type ───────────────────────────────────────────

export type Executor = OdooMcpClient["executeMethod"];

// ── Odoo record types ───────────────────────────────────────

export interface OdooInvoice {
  id: number;
  name: string;
  move_type: "out_invoice" | "out_refund" | "in_invoice" | "in_refund" | "entry";
  state: string;
  invoice_date: string;
  invoice_date_due: string;
  amount_total: number;
  amount_residual: number;
  amount_untaxed: number;
  amount_tax: number;
  currency_id: [number, string];
  partner_id: [number, string] | false;
  ref: string | false;
  invoice_line_ids: number[];
  payment_state: string;
  write_date: string;
}

export interface OdooPayment {
  id: number;
  name: string;
  payment_type: "inbound" | "outbound";
  partner_type: string;
  amount: number;
  currency_id: [number, string];
  partner_id: [number, string] | false;
  date: string;
  state: string;
  ref: string | false;
  journal_id: [number, string];
  write_date: string;
}

export interface OdooPurchaseOrder {
  id: number;
  name: string;
  state: string;
  date_order: string;
  date_planned: string;
  amount_total: number;
  amount_untaxed: number;
  amount_tax: number;
  currency_id: [number, string];
  partner_id: [number, string] | false;
  order_line: number[];
  write_date: string;
}

export interface OdooSalesOrder {
  id: number;
  name: string;
  state: string;
  date_order: string;
  amount_total: number;
  amount_untaxed: number;
  amount_tax: number;
  currency_id: [number, string];
  partner_id: [number, string] | false;
  order_line: number[];
  write_date: string;
}

export interface OdooAccount {
  id: number;
  code: string;
  name: string;
  account_type: string;
  reconcile: boolean;
  deprecated: boolean;
}

export interface OdooPartner {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  vat: string | false;
  supplier_rank: number;
  customer_rank: number;
  country_id: [number, string] | false;
  write_date: string;
}

// ── SyncableModel registry ──────────────────────────────────

export type SyncableModel =
  | "invoices"
  | "bills"
  | "payments"
  | "purchase_orders"
  | "sales_orders"
  | "journal_entries"
  | "chart_of_accounts"
  | "partners";

export const SYNCABLE_MODELS: Record<
  SyncableModel,
  { label: string; odooModel: string; domain: string }
> = {
  invoices: { label: "Invoices", odooModel: "account.move", domain: "revenue" },
  bills: { label: "Bills", odooModel: "account.move", domain: "expenses" },
  payments: { label: "Payments", odooModel: "account.payment", domain: "banking" },
  purchase_orders: { label: "Purchase Orders", odooModel: "purchase.order", domain: "expenses" },
  sales_orders: { label: "Sales Orders", odooModel: "sale.order", domain: "revenue" },
  journal_entries: { label: "Journal Entries", odooModel: "account.move", domain: "finance" },
  chart_of_accounts: { label: "Chart of Accounts", odooModel: "account.account", domain: "finance" },
  partners: { label: "Partners", odooModel: "res.partner", domain: "expenses" },
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Build a write_date domain filter for incremental sync.
 * Uses >= so records sharing the cursor timestamp are re-fetched
 * (Company-DB deduplicates by path, so re-submits are idempotent).
 * Returns an empty array when `since` is null (full sync).
 */
function sinceFilter(since: Date | null): unknown[] {
  if (!since) return [];
  return [["write_date", ">=", since.toISOString().replace("T", " ").slice(0, 19)]];
}

// ── Fetch functions ─────────────────────────────────────────

export async function fetchInvoices(
  exec: Executor,
  since: Date | null,
): Promise<OdooInvoice[]> {
  return (await exec({
    model: "account.move",
    method: "search_read",
    domain: [
      ["move_type", "in", ["out_invoice", "out_refund"]],
      ...sinceFilter(since),
    ],
  })) as OdooInvoice[];
}

export async function fetchBills(
  exec: Executor,
  since: Date | null,
): Promise<OdooInvoice[]> {
  return (await exec({
    model: "account.move",
    method: "search_read",
    domain: [
      ["move_type", "in", ["in_invoice", "in_refund"]],
      ...sinceFilter(since),
    ],
  })) as OdooInvoice[];
}

export async function fetchPayments(
  exec: Executor,
  since: Date | null,
): Promise<OdooPayment[]> {
  return (await exec({
    model: "account.payment",
    method: "search_read",
    domain: [...sinceFilter(since)],
  })) as OdooPayment[];
}

export async function fetchPurchaseOrders(
  exec: Executor,
  since: Date | null,
): Promise<OdooPurchaseOrder[]> {
  return (await exec({
    model: "purchase.order",
    method: "search_read",
    domain: [...sinceFilter(since)],
  })) as OdooPurchaseOrder[];
}

export async function fetchSalesOrders(
  exec: Executor,
  since: Date | null,
): Promise<OdooSalesOrder[]> {
  return (await exec({
    model: "sale.order",
    method: "search_read",
    domain: [...sinceFilter(since)],
  })) as OdooSalesOrder[];
}

export async function fetchJournalEntries(
  exec: Executor,
  since: Date | null,
): Promise<OdooInvoice[]> {
  return (await exec({
    model: "account.move",
    method: "search_read",
    domain: [["move_type", "=", "entry"], ...sinceFilter(since)],
  })) as OdooInvoice[];
}

export async function fetchChartOfAccounts(
  exec: Executor,
): Promise<OdooAccount[]> {
  return (await exec({
    model: "account.account",
    method: "search_read",
    domain: [["deprecated", "=", false]],
  })) as OdooAccount[];
}

export async function fetchPartners(
  exec: Executor,
  since: Date | null,
): Promise<OdooPartner[]> {
  return (await exec({
    model: "res.partner",
    method: "search_read",
    domain: since
      ? ["&", "|", ["supplier_rank", ">", 0], ["customer_rank", ">", 0], ...sinceFilter(since)]
      : ["|", ["supplier_rank", ">", 0], ["customer_rank", ">", 0]],
  })) as OdooPartner[];
}

// ── Generic search (for Claude chat tool) ───────────────────

export interface GenericSearchParams {
  model: string;
  domain: unknown[];
  fields?: string[];
  limit?: number;
  offset?: number;
}

export async function genericSearch(
  exec: Executor,
  params: GenericSearchParams,
): Promise<unknown[]> {
  return (await exec({
    model: params.model,
    method: "search_read",
    domain: params.domain,
    fields: params.fields,
    limit: params.limit,
    offset: params.offset,
  })) as unknown[];
}

// ── Single record lookup ────────────────────────────────────

export async function fetchRecordById(
  exec: Executor,
  model: string,
  recordId: number,
): Promise<unknown | null> {
  const records = (await exec({
    model,
    method: "search_read",
    domain: [["id", "=", recordId]],
    limit: 1,
  })) as unknown[];

  return records.length > 0 ? records[0] : null;
}

// ── MODEL_FETCHERS map ──────────────────────────────────────

export const MODEL_FETCHERS: Record<
  SyncableModel,
  (exec: Executor, since: Date | null) => Promise<unknown[]>
> = {
  invoices: fetchInvoices,
  bills: fetchBills,
  payments: fetchPayments,
  purchase_orders: fetchPurchaseOrders,
  sales_orders: fetchSalesOrders,
  journal_entries: fetchJournalEntries,
  chart_of_accounts: (exec) => fetchChartOfAccounts(exec),
  partners: fetchPartners,
};
