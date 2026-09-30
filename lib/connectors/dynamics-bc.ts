import {
  getMicrosoftAccessToken,
  getMicrosoftServicePrincipalCredentials,
} from "@/lib/connectors/microsoft-auth";
import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DYNAMICS_BC_SCOPE = "https://api.businesscentral.dynamics.com/.default";
const MAX_DYNAMICS_TOP = 200;
const DYNAMICS_BC_TIMEOUT_MS = 15_000;

export type DynamicsBcCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environmentName: string;
  companyId?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getDynamicsBcCredentials(
  credentials: Record<string, unknown>,
): DynamicsBcCredentials | null {
  const base = getMicrosoftServicePrincipalCredentials(credentials);
  const environmentName = normalizeString(credentials.environmentName);
  const companyId = normalizeString(credentials.companyId);

  if (!base || !environmentName) {
    return null;
  }

  return {
    ...base,
    environmentName,
    ...(companyId ? { companyId } : {}),
  };
}

function dynamicsBcBaseUrl(credentials: DynamicsBcCredentials) {
  return `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(credentials.tenantId)}/${encodeURIComponent(credentials.environmentName)}/api/v2.0`;
}

async function dynamicsBcRequest<T>(
  credentialsRecord: Record<string, unknown>,
  path: string,
  options?: {
    query?: Record<string, string | number | undefined>;
  },
): Promise<T> {
  const credentials = getDynamicsBcCredentials(credentialsRecord);
  if (!credentials) {
    throw new Error("Dynamics 365 Business Central credentials are incomplete");
  }

  const accessToken = await getMicrosoftAccessToken(credentials, DYNAMICS_BC_SCOPE);
  const url = new URL(`${dynamicsBcBaseUrl(credentials)}${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
    {
      timeoutMs: DYNAMICS_BC_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const errorMessage =
      payload &&
      typeof payload === "object" &&
      "error" in (payload as Record<string, unknown>) &&
      typeof (payload as Record<string, unknown>).error === "object" &&
      (payload as Record<string, unknown>).error &&
      typeof ((payload as Record<string, unknown>).error as Record<string, unknown>).message ===
        "string"
        ? (((payload as Record<string, unknown>).error as Record<string, unknown>).message as string)
        : `Dynamics 365 Business Central request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

function getTop(input: Record<string, unknown>, fallback = 25): number {
  const value = input.top;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, 1), MAX_DYNAMICS_TOP);
}

function getSkip(input: Record<string, unknown>): number {
  const value = input.skip;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return 0;
  }
  return Math.max(value, 0);
}

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

function getOptionalFilter(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.filter === "string" && payload.filter.trim().length > 0) {
    throw new Error(
      "Explicit OData filters are not supported. Use typed query, postingDateFrom, or postingDateTo inputs.",
    );
  }
  return undefined;
}

function getOptionalDate(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildPostingDateFilter(
  payload: Record<string, unknown>,
  extras: string[] = [],
): string | undefined {
  const filters = [...extras];
  const postingDateFrom = getOptionalDate(payload, "postingDateFrom");
  const postingDateTo = getOptionalDate(payload, "postingDateTo");
  const explicitFilter = getOptionalFilter(payload);

  if (postingDateFrom) {
    filters.push(`postingDate ge ${postingDateFrom}`);
  }
  if (postingDateTo) {
    filters.push(`postingDate le ${postingDateTo}`);
  }
  if (explicitFilter) {
    filters.push(explicitFilter);
  }

  return filters.length > 0 ? filters.join(" and ") : undefined;
}

function buildContainsFilter(
  payload: Record<string, unknown>,
  fields: string[],
): string | undefined {
  const queryText =
    typeof payload.query === "string" && payload.query.trim().length > 0
      ? payload.query.trim()
      : "";
  if (!queryText) {
    return undefined;
  }

  const escaped = escapeODataString(queryText);
  return fields.map((field) => `contains(${field},'${escaped}')`).join(" or ");
}

function resolveCompanyId(
  payload: Record<string, unknown>,
  connectionCredentials: Record<string, unknown>,
): string {
  const payloadCompanyId = normalizeString(payload.companyId);
  if (payloadCompanyId) {
    return payloadCompanyId;
  }

  const connection = getDynamicsBcCredentials(connectionCredentials);
  return connection?.companyId ?? "";
}

export async function validateDynamicsBcConnection(credentials: Record<string, unknown>) {
  const companies = await dynamicsBcRequest<{ value?: Array<Record<string, unknown>> }>(
    credentials,
    "/companies",
    {
      query: { $top: 1 },
    },
  );

  const firstCompany = Array.isArray(companies.value) ? companies.value[0] : null;
  const normalized = getDynamicsBcCredentials(credentials);
  return {
    externalAccountId:
      firstCompany && typeof firstCompany.id === "string"
        ? firstCompany.id
        : normalized?.tenantId,
    metadata: {
      tenantId: normalized?.tenantId ?? null,
      environmentName: normalized?.environmentName ?? null,
      companyId:
        firstCompany && typeof firstCompany.id === "string"
          ? firstCompany.id
          : normalized?.companyId ?? null,
      companyName:
        firstCompany && typeof firstCompany.displayName === "string"
          ? firstCompany.displayName
          : null,
    },
  };
}

export async function executeDynamicsBcAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  getOptionalFilter(payload);
  const top = getTop(payload);
  const companiesTop = getTop(payload, 50);
  const skip = getSkip(payload);

  if (action === "list_companies") {
    const companies = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      "/companies",
      {
        query: { $top: companiesTop, $skip: skip },
      },
    );
    const rows = Array.isArray(companies.value) ? companies.value : [];
    const nextLink =
      typeof companies["@odata.nextLink"] === "string" ? companies["@odata.nextLink"] : null;

    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        count: rows.length,
        returnedCount: rows.length,
        top: companiesTop,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        companies: rows,
      },
    };
  }

  const companyId = resolveCompanyId(payload, connection.credentials);
  if (!companyId) {
    return {
      status: 400,
      body: { error: "companyId is required in the connection or request input" },
    };
  }

  const queryText =
    typeof payload.query === "string" && payload.query.trim().length > 0
      ? payload.query.trim()
      : "";
  const filter = queryText ? `contains(displayName,'${escapeODataString(queryText)}')` : undefined;
  const companyPath = `/companies(${encodeURIComponent(companyId)})`;

  if (action === "list_customers") {
    const customers = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/customers`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: filter,
        },
      },
    );
    const rows = Array.isArray(customers.value) ? customers.value : [];
    const nextLink =
      typeof customers["@odata.nextLink"] === "string" ? customers["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        customers: rows,
      },
    };
  }

  if (action === "list_bank_accounts") {
    const bankAccounts = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/bankAccounts`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: filter,
        },
      },
    );
    const rows = Array.isArray(bankAccounts.value) ? bankAccounts.value : [];
    const nextLink =
      typeof bankAccounts["@odata.nextLink"] === "string"
        ? bankAccounts["@odata.nextLink"]
        : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        bankAccounts: rows,
      },
    };
  }

  if (action === "list_vendors") {
    const vendors = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/vendors`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: filter,
        },
      },
    );
    const rows = Array.isArray(vendors.value) ? vendors.value : [];
    const nextLink =
      typeof vendors["@odata.nextLink"] === "string" ? vendors["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        vendors: rows,
      },
    };
  }

  if (action === "list_sales_invoices") {
    const invoices = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/salesInvoices`,
      {
        query: {
          $top: top,
          $skip: skip,
        },
      },
    );
    const rows = Array.isArray(invoices.value) ? invoices.value : [];
    const nextLink =
      typeof invoices["@odata.nextLink"] === "string" ? invoices["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        salesInvoices: rows,
      },
    };
  }

  if (action === "get_sales_invoice") {
    const salesInvoiceId = normalizeString(payload.salesInvoiceId);
    if (!salesInvoiceId) {
      return {
        status: 400,
        body: { error: "input.salesInvoiceId is required" },
      };
    }

    const salesInvoice = await dynamicsBcRequest<Record<string, unknown>>(
      connection.credentials,
      `${companyPath}/salesInvoices(${encodeURIComponent(salesInvoiceId)})`,
    );
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        salesInvoiceId,
        salesInvoice,
      },
    };
  }

  if (action === "list_sales_invoice_lines") {
    const salesInvoiceId = normalizeString(payload.salesInvoiceId);
    if (!salesInvoiceId) {
      return {
        status: 400,
        body: { error: "input.salesInvoiceId is required" },
      };
    }

    const lines = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/salesInvoices(${encodeURIComponent(salesInvoiceId)})/salesInvoiceLines`,
      {
        query: {
          $top: top,
          $skip: skip,
        },
      },
    );
    const rows = Array.isArray(lines.value) ? lines.value : [];
    const nextLink =
      typeof lines["@odata.nextLink"] === "string" ? lines["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        salesInvoiceId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        salesInvoiceLines: rows,
      },
    };
  }

  if (action === "list_purchase_invoices") {
    const queryFilter = buildContainsFilter(payload, [
      "vendorName",
      "vendorInvoiceNumber",
      "number",
    ]);
    const purchaseInvoices = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/purchaseInvoices`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: buildPostingDateFilter(payload, queryFilter ? [`(${queryFilter})`] : []),
        },
      },
    );
    const rows = Array.isArray(purchaseInvoices.value) ? purchaseInvoices.value : [];
    const nextLink =
      typeof purchaseInvoices["@odata.nextLink"] === "string"
        ? purchaseInvoices["@odata.nextLink"]
        : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        purchaseInvoices: rows,
      },
    };
  }

  if (action === "list_vendor_payment_journals") {
    const queryFilter = buildContainsFilter(payload, ["displayName", "code"]);
    const journals = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/vendorPaymentJournals`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: queryFilter,
        },
      },
    );
    const rows = Array.isArray(journals.value) ? journals.value : [];
    const nextLink =
      typeof journals["@odata.nextLink"] === "string" ? journals["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        vendorPaymentJournals: rows,
      },
    };
  }

  if (action === "list_vendor_payments") {
    const queryFilter = buildContainsFilter(payload, [
      "vendorNumber",
      "documentNumber",
      "externalDocumentNumber",
      "description",
    ]);
    const journalId = normalizeString(payload.vendorPaymentJournalId);
    const basePath = journalId
      ? `${companyPath}/vendorPaymentJournals(${encodeURIComponent(journalId)})/vendorPayments`
      : `${companyPath}/vendorPayments`;
    const payments = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      basePath,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: buildPostingDateFilter(payload, queryFilter ? [`(${queryFilter})`] : []),
        },
      },
    );
    const rows = Array.isArray(payments.value) ? payments.value : [];
    const nextLink =
      typeof payments["@odata.nextLink"] === "string" ? payments["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        vendorPaymentJournalId: journalId || null,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        vendorPayments: rows,
      },
    };
  }

  if (action === "get_vendor_payment") {
    const vendorPaymentId = normalizeString(payload.vendorPaymentId);
    if (!vendorPaymentId) {
      return {
        status: 400,
        body: { error: "input.vendorPaymentId is required" },
      };
    }

    const vendorPayment = await dynamicsBcRequest<Record<string, unknown>>(
      connection.credentials,
      `${companyPath}/vendorPayments(${encodeURIComponent(vendorPaymentId)})`,
    );
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        vendorPaymentId,
        vendorPayment,
      },
    };
  }

  if (action === "list_customer_payment_journals") {
    const queryFilter = buildContainsFilter(payload, ["displayName", "code"]);
    const journals = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/customerPaymentJournals`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: queryFilter,
        },
      },
    );
    const rows = Array.isArray(journals.value) ? journals.value : [];
    const nextLink =
      typeof journals["@odata.nextLink"] === "string" ? journals["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        customerPaymentJournals: rows,
      },
    };
  }

  if (action === "list_customer_payments") {
    const queryFilter = buildContainsFilter(payload, [
      "customerNumber",
      "documentNumber",
      "externalDocumentNumber",
      "description",
    ]);
    const journalId = normalizeString(payload.customerPaymentJournalId);
    const basePath = journalId
      ? `${companyPath}/customerPaymentJournals(${encodeURIComponent(journalId)})/customerPayments`
      : `${companyPath}/customerPayments`;
    const payments = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      basePath,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: buildPostingDateFilter(payload, queryFilter ? [`(${queryFilter})`] : []),
        },
      },
    );
    const rows = Array.isArray(payments.value) ? payments.value : [];
    const nextLink =
      typeof payments["@odata.nextLink"] === "string" ? payments["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        customerPaymentJournalId: journalId || null,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        customerPayments: rows,
      },
    };
  }

  if (action === "get_customer_payment") {
    const customerPaymentId = normalizeString(payload.customerPaymentId);
    if (!customerPaymentId) {
      return {
        status: 400,
        body: { error: "input.customerPaymentId is required" },
      };
    }

    const customerPayment = await dynamicsBcRequest<Record<string, unknown>>(
      connection.credentials,
      `${companyPath}/customerPayments(${encodeURIComponent(customerPaymentId)})`,
    );
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        customerPaymentId,
        customerPayment,
      },
    };
  }

  if (action === "get_purchase_invoice") {
    const purchaseInvoiceId = normalizeString(payload.purchaseInvoiceId);
    if (!purchaseInvoiceId) {
      return {
        status: 400,
        body: { error: "input.purchaseInvoiceId is required" },
      };
    }

    const purchaseInvoice = await dynamicsBcRequest<Record<string, unknown>>(
      connection.credentials,
      `${companyPath}/purchaseInvoices(${encodeURIComponent(purchaseInvoiceId)})`,
    );
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        purchaseInvoiceId,
        purchaseInvoice,
      },
    };
  }

  if (action === "list_purchase_invoice_lines") {
    const purchaseInvoiceId = normalizeString(payload.purchaseInvoiceId);
    if (!purchaseInvoiceId) {
      return {
        status: 400,
        body: { error: "input.purchaseInvoiceId is required" },
      };
    }

    const lines = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/purchaseInvoices(${encodeURIComponent(purchaseInvoiceId)})/purchaseInvoiceLines`,
      {
        query: {
          $top: top,
          $skip: skip,
        },
      },
    );
    const rows = Array.isArray(lines.value) ? lines.value : [];
    const nextLink =
      typeof lines["@odata.nextLink"] === "string" ? lines["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        purchaseInvoiceId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        purchaseInvoiceLines: rows,
      },
    };
  }

  if (action === "list_journals") {
    const queryFilter = buildContainsFilter(payload, ["displayName", "code"]);
    const journals = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/journals`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: buildPostingDateFilter(payload, queryFilter ? [`(${queryFilter})`] : []),
        },
      },
    );
    const rows = Array.isArray(journals.value) ? journals.value : [];
    const nextLink =
      typeof journals["@odata.nextLink"] === "string" ? journals["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        journals: rows,
      },
    };
  }

  if (action === "list_journal_lines") {
    const journalId = normalizeString(payload.journalId);
    if (!journalId) {
      return {
        status: 400,
        body: { error: "input.journalId is required" },
      };
    }

    const queryFilter = buildContainsFilter(payload, [
      "description",
      "documentNumber",
      "accountNumber",
    ]);
    const lines = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/journals(${encodeURIComponent(journalId)})/journalLines`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: buildPostingDateFilter(payload, queryFilter ? [`(${queryFilter})`] : []),
        },
      },
    );
    const rows = Array.isArray(lines.value) ? lines.value : [];
    const nextLink =
      typeof lines["@odata.nextLink"] === "string" ? lines["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        journalId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        journalLines: rows,
      },
    };
  }

  if (action === "list_general_ledger_entries") {
    const queryFilter = buildContainsFilter(payload, [
      "description",
      "documentNumber",
      "accountNumber",
    ]);
    const documentType =
      typeof payload.documentType === "string" && payload.documentType.trim().length > 0
        ? payload.documentType.trim()
        : "";
    const accountNumber =
      typeof payload.accountNumber === "string" && payload.accountNumber.trim().length > 0
        ? payload.accountNumber.trim()
        : "";
    const extraFilters = [
      queryFilter ? `(${queryFilter})` : null,
      documentType ? `documentType eq '${escapeODataString(documentType)}'` : null,
      accountNumber ? `accountNumber eq '${escapeODataString(accountNumber)}'` : null,
    ].filter((value): value is string => Boolean(value));

    const entries = await dynamicsBcRequest<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(
      connection.credentials,
      `${companyPath}/generalLedgerEntries`,
      {
        query: {
          $top: top,
          $skip: skip,
          $filter: buildPostingDateFilter(payload, extraFilters),
        },
      },
    );
    const rows = Array.isArray(entries.value) ? entries.value : [];
    const nextLink =
      typeof entries["@odata.nextLink"] === "string" ? entries["@odata.nextLink"] : null;
    return {
      status: 200,
      body: {
        provider: "dynamics_bc",
        action,
        companyId,
        count: rows.length,
        returnedCount: rows.length,
        top,
        skip,
        hasMore: nextLink !== null,
        nextSkip: nextLink !== null ? skip + rows.length : null,
        nextLink,
        generalLedgerEntries: rows,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported dynamics_bc action: ${action}` },
  };
}
