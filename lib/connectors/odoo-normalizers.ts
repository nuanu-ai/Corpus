/**
 * Odoo → QMD normalizers.
 *
 * Transforms raw Odoo records (fetched via MCP) into Company-DB QMD format.
 * Each normalizer returns a { path, frontmatter, body } triple that can be
 * serialised to a .qmd file and submitted to the Write Queue.
 */

import type {
  OdooInvoice,
  OdooPayment,
  OdooPurchaseOrder,
  OdooSalesOrder,
  OdooAccount,
  OdooPartner,
  SyncableModel,
} from "./odoo";

// ── Public types ─────────────────────────────────────────────

export interface QmdRecord {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Extract human-readable partner name from Odoo many2one field. */
function partnerName(field: [number, string] | false): string | null {
  return field ? field[1] : null;
}

/** Extract ISO currency code from Odoo currency_id. */
function currencyCode(field: [number, string]): string {
  return field[1];
}

/**
 * Convert an Odoo datetime string ("2026-01-15 10:00:00") or date
 * string ("2026-01-15") to an ISO date (YYYY-MM-DD).
 *
 * Odoo returns `false` (not null/empty string) for unset date fields, so
 * accept any shape and degrade to "" rather than throwing — otherwise a
 * single record with a missing date kills the whole sync page with
 * "e.split is not a function".
 */
function odooDateToISO(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.split(" ")[0];
}

/** Extract label from a many2one [id, name] tuple, or null from false. */
function many2oneName(field: [number, string] | false): string | null {
  return field ? field[1] : null;
}

/** Current ISO timestamp for synced_at. */
function nowISO(): string {
  return new Date().toISOString();
}

// ── Invoice (out_invoice / out_refund) ───────────────────────

export function normalizeInvoice(inv: OdooInvoice): QmdRecord {
  const id = `odoo-inv-${inv.id}`;
  const type = inv.move_type === "out_refund" ? "credit_note" : "invoice";

  return {
    path: `revenue/invoices/${id}.qmd`,
    frontmatter: {
      id,
      type,
      domain: "revenue",
      title: inv.name,
      status: inv.state,
      amount_total: inv.amount_total,
      amount_untaxed: inv.amount_untaxed,
      amount_tax: inv.amount_tax,
      amount_residual: inv.amount_residual,
      currency: currencyCode(inv.currency_id),
      partner: partnerName(inv.partner_id),
      invoice_date: odooDateToISO(inv.invoice_date),
      due_date: odooDateToISO(inv.invoice_date_due),
      payment_state: inv.payment_state,
      ref: inv.ref || null,
      odoo_id: inv.id,
      odoo_model: "account.move",
      synced_at: nowISO(),
    },
    body: `${inv.name}: ${inv.amount_total} ${currencyCode(inv.currency_id)}${partnerName(inv.partner_id) ? ` — ${partnerName(inv.partner_id)}` : ""}`,
  };
}

// ── Bill (in_invoice / in_refund) ────────────────────────────

export function normalizeBill(bill: OdooInvoice): QmdRecord {
  const id = `odoo-bill-${bill.id}`;
  const type = bill.move_type === "in_refund" ? "debit_note" : "bill";

  return {
    path: `expenses/bills/${id}.qmd`,
    frontmatter: {
      id,
      type,
      domain: "expenses",
      title: bill.name,
      status: bill.state,
      amount_total: bill.amount_total,
      amount_untaxed: bill.amount_untaxed,
      amount_tax: bill.amount_tax,
      amount_residual: bill.amount_residual,
      currency: currencyCode(bill.currency_id),
      partner: partnerName(bill.partner_id),
      invoice_date: odooDateToISO(bill.invoice_date),
      due_date: odooDateToISO(bill.invoice_date_due),
      payment_state: bill.payment_state,
      ref: bill.ref || null,
      odoo_id: bill.id,
      odoo_model: "account.move",
      synced_at: nowISO(),
    },
    body: `${bill.name}: ${bill.amount_total} ${currencyCode(bill.currency_id)}${partnerName(bill.partner_id) ? ` — ${partnerName(bill.partner_id)}` : ""}`,
  };
}

// ── Payment ──────────────────────────────────────────────────

export function normalizePayment(pmt: OdooPayment): QmdRecord {
  const id = `odoo-pmt-${pmt.id}`;

  return {
    path: `banking/payments/${id}.qmd`,
    frontmatter: {
      id,
      type: "payment",
      domain: "banking",
      title: pmt.name,
      status: pmt.state,
      direction: pmt.payment_type,
      amount: pmt.amount,
      currency: currencyCode(pmt.currency_id),
      partner: partnerName(pmt.partner_id),
      date: odooDateToISO(pmt.date),
      journal: many2oneName(pmt.journal_id),
      ref: pmt.ref || null,
      odoo_id: pmt.id,
      odoo_model: "account.payment",
      synced_at: nowISO(),
    },
    body: `${pmt.name}: ${pmt.payment_type} ${pmt.amount} ${currencyCode(pmt.currency_id)}${partnerName(pmt.partner_id) ? ` — ${partnerName(pmt.partner_id)}` : ""}`,
  };
}

// ── Purchase Order ───────────────────────────────────────────

export function normalizePurchaseOrder(po: OdooPurchaseOrder): QmdRecord {
  const id = `odoo-po-${po.id}`;

  return {
    path: `expenses/purchase-orders/${id}.qmd`,
    frontmatter: {
      id,
      type: "purchase_order",
      domain: "expenses",
      title: po.name,
      status: po.state,
      amount_total: po.amount_total,
      amount_untaxed: po.amount_untaxed,
      amount_tax: po.amount_tax,
      currency: currencyCode(po.currency_id),
      partner: partnerName(po.partner_id),
      date_order: odooDateToISO(po.date_order),
      date_planned: odooDateToISO(po.date_planned),
      odoo_id: po.id,
      odoo_model: "purchase.order",
      synced_at: nowISO(),
    },
    body: `${po.name}: ${po.amount_total} ${currencyCode(po.currency_id)}${partnerName(po.partner_id) ? ` — ${partnerName(po.partner_id)}` : ""}`,
  };
}

// ── Sales Order ──────────────────────────────────────────────

export function normalizeSalesOrder(so: OdooSalesOrder): QmdRecord {
  const id = `odoo-so-${so.id}`;

  return {
    path: `revenue/sales-orders/${id}.qmd`,
    frontmatter: {
      id,
      type: "sales_order",
      domain: "revenue",
      title: so.name,
      status: so.state,
      amount_total: so.amount_total,
      amount_untaxed: so.amount_untaxed,
      amount_tax: so.amount_tax,
      currency: currencyCode(so.currency_id),
      partner: partnerName(so.partner_id),
      date_order: odooDateToISO(so.date_order),
      odoo_id: so.id,
      odoo_model: "sale.order",
      synced_at: nowISO(),
    },
    body: `${so.name}: ${so.amount_total} ${currencyCode(so.currency_id)}${partnerName(so.partner_id) ? ` — ${partnerName(so.partner_id)}` : ""}`,
  };
}

// ── Journal Entry (move_type = "entry") ──────────────────────

export function normalizeJournalEntry(je: OdooInvoice): QmdRecord {
  const id = `odoo-je-${je.id}`;

  return {
    path: `finance/ledger/journal-entries/${id}.qmd`,
    frontmatter: {
      id,
      type: "journal_entry",
      domain: "finance",
      title: je.name,
      status: je.state,
      amount_total: je.amount_total,
      amount_untaxed: je.amount_untaxed,
      amount_tax: je.amount_tax,
      currency: currencyCode(je.currency_id),
      partner: partnerName(je.partner_id),
      invoice_date: odooDateToISO(je.invoice_date),
      ref: je.ref || null,
      odoo_id: je.id,
      odoo_model: "account.move",
      synced_at: nowISO(),
    },
    body: `${je.name}: ${je.amount_total} ${currencyCode(je.currency_id)}`,
  };
}

// ── Account (Chart of Accounts) ──────────────────────────────

export function normalizeAccount(acct: OdooAccount): QmdRecord {
  const id = `odoo-acct-${acct.code}`;

  return {
    path: `finance/chart-of-accounts/${id}.qmd`,
    frontmatter: {
      id,
      type: "account",
      domain: "finance",
      title: `${acct.code} - ${acct.name}`,
      code: acct.code,
      account_type: acct.account_type,
      reconcile: acct.reconcile,
      odoo_id: acct.id,
      odoo_model: "account.account",
      synced_at: nowISO(),
    },
    body: `Account ${acct.code}: ${acct.name} (${acct.account_type})`,
  };
}

// ── Partner ──────────────────────────────────────────────────

export function normalizePartner(p: OdooPartner): QmdRecord {
  // Customer rank takes priority when partner has both roles
  const isCustomer = p.customer_rank > 0;
  const isSupplier = p.supplier_rank > 0;

  let domain: string;
  let subdir: string;
  let type: string;

  if (isCustomer) {
    domain = "revenue";
    subdir = "customers";
    type = "customer";
  } else if (isSupplier) {
    domain = "expenses";
    subdir = "vendors";
    type = "vendor";
  } else {
    // Fallback — should not happen with our fetch filter, but be safe
    domain = "revenue";
    subdir = "customers";
    type = "contact";
  }

  const id = `odoo-partner-${p.id}`;

  return {
    path: `${domain}/${subdir}/${id}.qmd`,
    frontmatter: {
      id,
      type,
      domain,
      title: p.name,
      email: p.email || null,
      phone: p.phone || null,
      vat: p.vat || null,
      country: many2oneName(p.country_id),
      supplier_rank: p.supplier_rank,
      customer_rank: p.customer_rank,
      odoo_id: p.id,
      odoo_model: "res.partner",
      synced_at: nowISO(),
    },
    body: `${p.name}${p.email ? ` <${p.email}>` : ""}`,
  };
}

// ── Dispatcher ───────────────────────────────────────────────

const NORMALIZER_MAP: Record<SyncableModel, (record: never) => QmdRecord> = {
  invoices: normalizeInvoice,
  bills: normalizeBill,
  payments: normalizePayment,
  purchase_orders: normalizePurchaseOrder,
  sales_orders: normalizeSalesOrder,
  journal_entries: normalizeJournalEntry,
  chart_of_accounts: normalizeAccount,
  partners: normalizePartner,
};

/**
 * Normalize any Odoo record by its SyncableModel key.
 * Throws if the model key is unknown.
 */
export function normalizeOdooRecord(
  modelKey: SyncableModel,
  record: unknown,
): QmdRecord {
  const normalizer = NORMALIZER_MAP[modelKey];
  if (!normalizer) {
    throw new Error(`Unknown model key: "${modelKey}"`);
  }
  return normalizer(record as never);
}
