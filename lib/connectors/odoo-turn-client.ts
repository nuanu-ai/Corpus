/**
 * Per-turn Odoo MCP client.
 *
 * The naive pattern (withOdooClient inside every tool) opens a fresh SSE
 * handshake (2-6s) on each `search_odoo` / `get_odoo_record` call. A multi-call
 * Odoo turn (avg 3.5 steps in prod) pays this overhead 3-4× for no reason.
 *
 * createTurnOdooClient hoists the connection up to the chat-turn lifecycle:
 *   - lazy: nothing happens until the first Odoo tool actually runs
 *   - memoized: subsequent tools reuse the same `OdooMcpClient`
 *   - safe: disconnect() in onFinish/onAbort guarantees the SSE socket closes
 *   - tolerant: re-running disconnect after error is a no-op
 */

import {
  OdooMcpClient,
} from "@/lib/connectors/odoo-mcp-client";
import { listConnections } from "@/lib/connections";

interface OdooConnectionMeta {
  portalUrl: string;
  token: string;
}

export interface TurnOdooClient {
  /** Lazily open the MCP client and return it. Throws TurnOdooError if not connected. */
  getClient: () => Promise<OdooMcpClient>;
  /** Idempotent. Safe in onFinish AND onAbort. */
  disconnect: () => Promise<void>;
  /** Snapshot of last known status — useful for tool error messages. */
  getStatus: () => "uninitialised" | "connecting" | "ready" | "failed" | "closed";
}

export class TurnOdooError extends Error {
  readonly kind: "no_connection" | "no_credentials" | "connect_failed";
  readonly hint?: string;

  constructor(kind: TurnOdooError["kind"], message: string, hint?: string) {
    super(message);
    this.name = "TurnOdooError";
    this.kind = kind;
    this.hint = hint;
  }
}

export function createTurnOdooClient(companyId: string): TurnOdooClient {
  let status: ReturnType<TurnOdooClient["getStatus"]> = "uninitialised";
  let client: OdooMcpClient | null = null;
  let credsPromise: Promise<OdooConnectionMeta> | null = null;
  let connectPromise: Promise<OdooMcpClient> | null = null;

  async function loadCreds(): Promise<OdooConnectionMeta> {
    if (credsPromise) return credsPromise;
    credsPromise = (async () => {
      const all = await listConnections(companyId);
      const odooConnections = all
        .filter((c) => c.provider === "odoo")
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      const active = odooConnections.find((c) => c.status === "active");
      if (!active) {
        const failing = odooConnections[0];
        throw new TurnOdooError(
          "no_connection",
          failing?.lastError
            ? `Odoo requires reconnection: ${failing.lastError}`
            : "Odoo is not connected. Go to Integrations to connect your Odoo ERP.",
        );
      }
      const { getConnectionCredentials } = await import("@/lib/connections");
      const creds = await getConnectionCredentials(active.id, companyId);
      if (!creds) {
        throw new TurnOdooError("no_credentials", "Odoo credentials not found");
      }
      return {
        portalUrl: creds.credentials.portalUrl as string,
        token: creds.credentials.token as string,
      };
    })();
    return credsPromise;
  }

  return {
    getStatus: () => status,
    getClient: async () => {
      if (client && (status === "ready" || status === "connecting")) {
        if (connectPromise) await connectPromise;
        return client;
      }
      if (connectPromise) return connectPromise;
      status = "connecting";
      connectPromise = (async () => {
        try {
          const meta = await loadCreds();
          const c = new OdooMcpClient(meta.portalUrl, meta.token);
          await c.connect();
          client = c;
          status = "ready";
          return c;
        } catch (err) {
          status = "failed";
          if (err instanceof TurnOdooError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          throw new TurnOdooError("connect_failed", `Odoo MCP connect failed: ${msg}`);
        } finally {
          // Allow retry on transient failure: clear the in-flight promise so a
          // future getClient() call can re-attempt. The cached `client` /
          // `status` reflect the latest outcome.
          connectPromise = null;
        }
      })();
      return connectPromise;
    },
    disconnect: async () => {
      if (status === "closed") return;
      const toClose = client;
      client = null;
      const previousStatus = status;
      status = "closed";
      if (toClose && previousStatus === "ready") {
        try {
          await toClose.disconnect();
        } catch (err) {
          console.warn("[odoo-turn-client] disconnect failed:", err);
        }
      }
    },
  };
}

/** Map a TurnOdooError into a tool-shaped response payload. */
export function toolResponseForTurnError(
  action: "odoo_search" | "odoo_record" | "odoo_revenue" | "odoo_vendor_spend" | "odoo_purchases" | "odoo_pnl" | "odoo_recurring",
  err: TurnOdooError,
) {
  return {
    action,
    error: err.message,
    ...(action === "odoo_search" || action === "odoo_revenue" || action === "odoo_vendor_spend" || action === "odoo_purchases" || action === "odoo_pnl" || action === "odoo_recurring"
      ? { results: [] }
      : {}),
  };
}
