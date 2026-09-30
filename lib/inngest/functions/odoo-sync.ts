/**
 * Odoo Sync — Inngest functions.
 *
 * Two functions:
 *  1. odooTransactionSync — fetches user-selected Odoo models, normalizes
 *     to QMD, and submits each record to the Company-DB Write Queue.
 *     Triggered by `connection/odoo.connected` (initial sync) and
 *     `odoo/sync.requested` (on-demand / scheduled re-sync).
 *  2. odooReconciliationPoll — daily cron that fires `odoo/sync.requested`
 *     for every active Odoo connection.
 */

import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import { withOdooClient } from "@/lib/connectors/odoo-mcp-client";
import { SYNCABLE_MODELS, type SyncableModel } from "@/lib/connectors/odoo";
import { normalizeOdooRecord, type QmdRecord } from "@/lib/connectors/odoo-normalizers";
import { db } from "@/lib/db";
import { connections, companies } from "@/lib/db/schema";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import {
  buildCompanyDbQueueHeadersForUrl,
  getCompanyDbWriteIntentToken,
} from "@/lib/company-db/internal-service-auth";
import YAML from "yaml";

const PAGE_SIZE = 200;
const COMPANY_DB_HOST = process.env.COMPANY_DB_HOST ?? "localhost";
const ODOO_AGENT_ID = process.env.ODOO_SYNC_AGENT_ID ?? "odoo-sync-agent";

export function isOdooAuthFailure(message: string | null | undefined): boolean {
  const text = String(message ?? "").toLowerCase();
  return text.includes("401") || text.includes("unauthorized");
}

export function normalizeOdooLastError(message: string | null): string | null {
  if (!message) return null;
  if (isOdooAuthFailure(message)) {
    return "Odoo authorization failed (401). Reconnect the integration in Integrations.";
  }
  return message;
}

/**
 * Submit a QMD record to Company-DB Write Queue.
 * Uses the correct WriteIntent format matching submitKnowledgeDoc pattern.
 */
async function submitOdooQmd(
  companySlug: string,
  qmd: QmdRecord,
  content: string,
  writeQueuePort: number,
): Promise<void> {
  const writeQueueToken = getCompanyDbWriteIntentToken();

  if (!writeQueueToken) throw new Error("Company-DB write intent token is not configured");

  const domain = qmd.frontmatter.domain as string;
  const title = (qmd.frontmatter.title as string) || qmd.path;

  const writeUrl = `http://${COMPANY_DB_HOST}:${writeQueuePort}/write`;
  const payload = {
    agentId: ODOO_AGENT_ID,
    agentToken: writeQueueToken,
    domain,
    operation: {
      type: "commit",
      files: [{ path: qmd.path, content }],
      commitMessage: `odoo-sync(${domain}): ${title}`,
    },
    metadata: {
      companySlug,
      source: "odoo-sync",
      odooId: qmd.frontmatter.odoo_id,
    },
  };

  const res = await fetch(writeUrl, {
    method: "POST",
    headers: buildCompanyDbQueueHeadersForUrl({
      url: writeUrl,
      method: "POST",
      body: payload,
      contentType: "application/json",
    }),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new Error(`Write Queue error (${res.status}): ${text}`);
  }

  const result = await res.json();
  if (!result.success) {
    const code = result.error?.code ?? "unknown";
    const msg = result.error?.message ?? "Write Queue returned success: false";
    throw new Error(`Write Queue rejected (${code}): ${msg}`);
  }
}

/**
 * Sync Odoo data for a connected account.
 * Fetches user-selected models, normalizes to QMD, submits to Write Queue.
 */
export const odooTransactionSync = inngest.createFunction(
  {
    id: "odoo-transaction-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/odoo.connected" },
    { event: "odoo/sync.requested" },
  ],
  async ({ event, step }) => {
    const { connectionId, companyId } = event.data as {
      connectionId: string;
      companyId: string;
    };

    // Step 1: Get credentials + sync config
    const connData = await step.run("get-credentials", async () => {
      const conn = await getConnectionCredentials(connectionId, companyId);
      if (!conn) throw new Error(`Connection ${connectionId} not found`);
      return {
        portalUrl: conn.credentials.portalUrl as string,
        token: conn.credentials.token as string,
        syncModels: ((conn.metadata as Record<string, unknown>)?.syncModels as string[]) || [],
        lastSyncAt: ((conn.metadata as Record<string, unknown>)?.lastSyncAt as Record<string, string>) || {},
      };
    });

    if (connData.syncModels.length === 0) {
      return { connectionId, companyId, synced: 0, message: "No models selected for sync" };
    }

    // Step 2: Resolve company slug + write queue port
    const companyInfo = await step.run("resolve-company", async () => {
      const slug = await getCompanySlug(companyId);
      const [row] = await db
        .select({ companyDbPort: companies.companyDbPort })
        .from(companies)
        .where(eq(companies.id, companyId));
      return { slug, writeQueuePort: (row?.companyDbPort ?? 3100) + 1 };
    });

    // Step 3: Fetch + normalize + submit each selected model
    let totalSynced = 0;
    let totalFailed = 0;
    let lastFailedError: string | null = null;
    const newLastSyncAt: Record<string, string> = { ...connData.lastSyncAt };
    const changedDomains = new Set<string>();

    for (const modelKey of connData.syncModels) {
      const typedKey = modelKey as SyncableModel;
      if (!SYNCABLE_MODELS[typedKey]) continue;

      let offset = 0;
      let hasMore = true;
      let maxWriteDate: string | null = connData.lastSyncAt[modelKey] ?? null;

      while (hasMore) {
        const pageResult = await step.run(`sync-${modelKey}-page-${offset}`, async () => {
          const since = connData.lastSyncAt[modelKey]
            ? new Date(connData.lastSyncAt[modelKey])
            : null;

          try {
            return await withOdooClient(connData.portalUrl, connData.token, async (client) => {
              const exec = client.executeMethod.bind(client);

              // Build domain filter for this model
              // Use >= so records sharing the cursor's write_date are re-fetched
              // on the next sync. Company-DB Write Queue deduplicates by path,
              // so re-submitting the same record is idempotent.
              const sincePart = since
                ? [["write_date", ">=", since.toISOString().replace("T", " ").slice(0, 19)]]
                : [];

              let domain: unknown[];
              switch (typedKey) {
                case "invoices":
                  domain = [["move_type", "in", ["out_invoice", "out_refund"]], ...sincePart];
                  break;
                case "bills":
                  domain = [["move_type", "in", ["in_invoice", "in_refund"]], ...sincePart];
                  break;
                case "journal_entries":
                  domain = [["move_type", "=", "entry"], ...sincePart];
                  break;
                case "chart_of_accounts":
                  domain = [["deprecated", "=", false]];
                  break;
                case "partners":
                  domain = sincePart.length
                    ? ["&", "|", ["supplier_rank", ">", 0], ["customer_rank", ">", 0], ...sincePart]
                    : ["|", ["supplier_rank", ">", 0], ["customer_rank", ">", 0]];
                  break;
                default:
                  domain = [...sincePart];
              }

              const rawResult = await exec({
                model: SYNCABLE_MODELS[typedKey].odooModel,
                method: "search_read",
                domain,
                limit: PAGE_SIZE,
                offset,
                order: "write_date asc",
              });

              // executeMethod may return an array directly, or the MCP
              // client's parseToolResult already unwraps the Odoo wrapper.
              // Guard against non-iterable responses (e.g. error objects).
              const records = Array.isArray(rawResult)
                ? (rawResult as Array<Record<string, unknown>>)
                : [];

              if (!Array.isArray(rawResult)) {
                console.warn(
                  `[odoo-sync] ${modelKey}: expected array, got ${typeof rawResult}`,
                  JSON.stringify(rawResult).slice(0, 200),
                );
              }

              let count = 0;
              let failed = 0;
              let failError: string | null = null;
              let pageMaxWriteDate: string | null = null;
              const pageChangedDomains = new Set<string>();

              for (const record of records) {
                const qmd = normalizeOdooRecord(typedKey, record);
                const yamlStr = YAML.stringify(qmd.frontmatter).trimEnd();
                const content = `---\n${yamlStr}\n---\n\n${qmd.body}\n`;

                try {
                  await submitOdooQmd(companyInfo.slug, qmd, content, companyInfo.writeQueuePort);
                  count++;
                  pageChangedDomains.add(String(qmd.frontmatter.domain ?? ""));
                  const wd = record.write_date as string;
                  if (wd && (!pageMaxWriteDate || wd > pageMaxWriteDate)) {
                    pageMaxWriteDate = wd;
                  }
                } catch (err) {
                  failed++;
                  failError = err instanceof Error ? err.message : "Submit failed";
                  console.error(`Failed to submit ${qmd.path}:`, err);
                }
              }

              return {
                count,
                failed,
                failError,
                fetched: records.length,
                maxWriteDate: pageMaxWriteDate,
                changedDomains: Array.from(pageChangedDomains).filter(Boolean),
              };
            });
          } catch (err) {
            // Catch Odoo MCP errors (timeouts, permission errors) and return
            // as a non-retryable result so the function continues to the next model.
            const msg = err instanceof Error ? err.message : "Unknown fetch error";
            console.warn(`[odoo-sync] ${modelKey} page ${offset} failed: ${msg}`);
            return {
              count: 0,
              failed: 0,
              failError: msg,
              fetched: 0,
              maxWriteDate: null,
              changedDomains: [] as string[],
            };
          }
        });

        totalSynced += pageResult.count;
        totalFailed += pageResult.failed;
        for (const domain of pageResult.changedDomains) {
          changedDomains.add(domain);
        }
        if (pageResult.failError) lastFailedError = pageResult.failError;
        if (pageResult.maxWriteDate && (!maxWriteDate || pageResult.maxWriteDate > maxWriteDate)) {
          maxWriteDate = pageResult.maxWriteDate;
        }
        hasMore = pageResult.fetched >= PAGE_SIZE;
        offset += PAGE_SIZE;
      }

      if (maxWriteDate) {
        newLastSyncAt[modelKey] = maxWriteDate;
      }
    }

    // Step 4: Update connection metadata
    await step.run("update-sync-metadata", async () => {
      const conn = await getConnectionCredentials(connectionId, companyId);
      const existingMeta = (conn?.metadata as Record<string, unknown>) || {};
      const normalizedLastError = normalizeOdooLastError(lastFailedError);
      const connectionStatus = normalizedLastError && isOdooAuthFailure(lastFailedError)
        ? "error"
        : "active";

      await db
        .update(connections)
        .set({
          status: connectionStatus,
          lastSyncAt: new Date(),
          errorCount: totalFailed > 0 ? totalFailed : 0,
          lastError: normalizedLastError,
          metadata: {
            ...existingMeta,
            lastSyncAt: newLastSyncAt,
            lastSyncResult: totalFailed > 0
              ? `${totalSynced} records synced, ${totalFailed} failed`
              : `${totalSynced} records synced`,
          },
          updatedAt: new Date(),
        })
        .where(and(eq(connections.id, connectionId), eq(connections.companyId, companyId)));
    });

    await step.run("refresh-summary-targets", async () => {
      if (totalSynced === 0 || changedDomains.size === 0) return null;

      try {
        return await refreshSummaryTargets({
          companySlug: companyInfo.slug,
          port: companyInfo.writeQueuePort - 1,
          writeQueuePort: companyInfo.writeQueuePort,
          domains: Array.from(changedDomains),
          reason: "queue_write",
        });
      } catch (error) {
        console.warn("[summary-materializer] odoo refresh failed", error);
        return null;
      }
    });

    return { connectionId, companyId, synced: totalSynced, failed: totalFailed };
  },
);

/**
 * Daily poll: trigger sync for all active Odoo connections.
 */
export const odooReconciliationPoll = inngest.createFunction(
  { id: "odoo-reconciliation-poll" },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    const activeConnections = await step.run("list-active-odoo-connections", async () => {
      return db
        .select({ id: connections.id, companyId: connections.companyId })
        .from(connections)
        .where(and(eq(connections.provider, "odoo"), eq(connections.status, "active")));
    });

    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-odoo-syncs",
        activeConnections.map((conn) => ({
          name: "odoo/sync.requested" as const,
          data: { connectionId: conn.id, companyId: conn.companyId },
        })),
      );
    }

    return { triggered: activeConnections.length };
  },
);
