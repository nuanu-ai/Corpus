/**
 * MCP (Model Context Protocol) server definitions for company-db.
 *
 * This module defines the tool and resource schemas that will be exposed
 * via the MCP protocol. The actual protocol transport (stdio / HTTP SSE)
 * is deferred — only the schema definitions are exported here.
 */

// ── Tool definitions ─────────────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "query_financials",
    description: "Query financial data — journal entries, ledger accounts, reports. Supports filtering by period, account, and type.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Period in YYYY-MM format (e.g. 2024-01)" },
        account: { type: "string", description: "Account name or ID to filter by" },
        type: {
          type: "string",
          description: "Entity type to query",
          enum: ["journal_entry", "ledger_account", "financial_report"],
        },
        limit: { type: "number", description: "Maximum number of results (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "query_metrics",
    description: "Query business metrics — KPIs, performance indicators, trend data. Returns time-series data when period range is specified.",
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", description: "Metric name (e.g. mrr, churn_rate, burn_rate)" },
        from: { type: "string", description: "Start period YYYY-MM" },
        to: { type: "string", description: "End period YYYY-MM" },
        domain: { type: "string", description: "Domain to scope metrics to (e.g. revenue, expenses)" },
      },
      required: [],
    },
  },
  {
    name: "submit_document",
    description: "Submit a document for extraction and storage. The document will be parsed, validated, and committed to the company repository.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Target domain for the document",
          enum: [
            "finance", "banking", "revenue", "expenses", "tax",
            "people", "operations",
          ],
        },
        content: { type: "string", description: "Document content (raw text, CSV, or structured data)" },
        format: {
          type: "string",
          description: "Document format hint",
          enum: ["text", "csv", "json", "pdf_text"],
        },
        metadata: { type: "string", description: "Optional JSON metadata about the document source" },
      },
      required: ["domain", "content"],
    },
  },
  {
    name: "query_customers",
    description: "Query customer data — customer profiles, contracts, payment history. Supports search by name, status, and segment.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer name (partial match)" },
        status: {
          type: "string",
          description: "Customer status filter",
          enum: ["active", "churned", "prospect", "archived"],
        },
        segment: { type: "string", description: "Customer segment" },
        limit: { type: "number", description: "Maximum number of results (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "query_inventory",
    description: "Query inventory levels — products, stock, warehouse data. Returns current quantities and reorder alerts.",
    inputSchema: {
      type: "object",
      properties: {
        product: { type: "string", description: "Product name or SKU (partial match)" },
        warehouse: { type: "string", description: "Warehouse location filter" },
        belowReorder: { type: "string", description: "If 'true', only return items below reorder point" },
        limit: { type: "number", description: "Maximum number of results (default 50)" },
      },
      required: [],
    },
  },
];

// ── Resource definitions ─────────────────────────────────────────────────

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: "company://financials",
    name: "Financial Summary",
    description: "Aggregated financial overview — P&L, balance sheet, cash flow summary for the current period.",
    mimeType: "application/json",
  },
  {
    uri: "company://customers",
    name: "Customer List",
    description: "Active customer directory with key metrics (MRR, lifetime value, churn risk).",
    mimeType: "application/json",
  },
  {
    uri: "company://inventory",
    name: "Inventory Status",
    description: "Current inventory levels across all warehouses with reorder alerts.",
    mimeType: "application/json",
  },
  {
    uri: "company://metrics",
    name: "Business Metrics",
    description: "Key business metrics dashboard — MRR, burn rate, runway, growth rate.",
    mimeType: "application/json",
  },
  {
    uri: "company://team",
    name: "Team Directory",
    description: "Employee and contractor directory with roles and departments.",
    mimeType: "application/json",
  },
];

// ── Server config (for future transport setup) ───────────────────────────

export interface McpServerConfig {
  name: string;
  version: string;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
}

export function getMcpServerConfig(): McpServerConfig {
  return {
    name: "company-db",
    version: "0.0.1",
    tools: MCP_TOOLS,
    resources: MCP_RESOURCES,
  };
}
