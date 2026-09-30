import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { connections, notifications } from "@/lib/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import {
  coerceGoogleDriveConnectionMetadata,
  hasGoogleDriveActiveAutoImport,
} from "@/lib/connectors/google-drive";
import {
  formatElapsedSyncWindow,
  formatExpectedSyncInterval,
  getExpectedSyncInterval as getExpectedInterval,
  isExpectedSyncStale,
  shouldAlertNeverSynced,
} from "@/lib/connectors/sync-health";
export { getExpectedInterval };

/** Build a human-readable alert title. */
export function buildAlertTitle(provider: string, level: "amber" | "red" | "auth_expiry"): string {
  const name = provider.charAt(0).toUpperCase() + provider.slice(1);
  switch (level) {
    case "amber": return `${name} sync delayed`;
    case "red": return `${name} sync failing`;
    case "auth_expiry": return `${name} authorization expiring`;
  }
}

export const syncHealthCheck = inngest.createFunction(
  { id: "sync-health-check" },
  { cron: "*/15 * * * *" }, // every 15 minutes
  async ({ step }) => {
    // Step 1: Get all active connections
    const activeConnections = await step.run("get-active-connections", async () => {
      return db
        .select({
          id: connections.id,
          companyId: connections.companyId,
          provider: connections.provider,
          status: connections.status,
          lastSyncAt: connections.lastSyncAt,
          lastError: connections.lastError,
          errorCount: connections.errorCount,
          metadata: connections.metadata,
          createdAt: connections.createdAt,
        })
        .from(connections)
        .where(eq(connections.status, "active"));
    });

    // Step 2: Check each connection's health
    const alerts = await step.run("check-health", async () => {
      const now = new Date();
      const results: Array<{
        connectionId: string;
        companyId: string;
        provider: string;
        level: "amber" | "red" | "auth_expiry";
        reason: string;
      }> = [];

      for (const conn of activeConnections) {
        const expectedInterval = getExpectedInterval(conn.provider);
        const googleDrivePassive =
          conn.provider === "google_drive" &&
          !hasGoogleDriveActiveAutoImport(
            coerceGoogleDriveConnectionMetadata(conn.metadata)
          );

        // Check 1: Red alert — error_count >= 3
        if (conn.errorCount >= 3) {
          results.push({
            connectionId: conn.id,
            companyId: conn.companyId,
            provider: conn.provider,
            level: "red",
            reason: `${conn.errorCount} consecutive errors. Last error: ${conn.lastError || "unknown"}`,
          });
        } else if (
          expectedInterval !== null &&
          conn.lastSyncAt &&
          isExpectedSyncStale(conn.lastSyncAt, expectedInterval, now)
        ) {
          const lastSync = new Date(conn.lastSyncAt);
          const staleness = now.getTime() - lastSync.getTime();
            results.push({
              connectionId: conn.id,
              companyId: conn.companyId,
              provider: conn.provider,
              level: "amber",
              reason: `No sync for ${formatElapsedSyncWindow(staleness)} (expected every ${formatExpectedSyncInterval(expectedInterval)})`,
            });
        } else if (
          expectedInterval !== null &&
          !googleDrivePassive &&
          shouldAlertNeverSynced(conn.createdAt, expectedInterval, now)
        ) {
          results.push({
            connectionId: conn.id,
            companyId: conn.companyId,
            provider: conn.provider,
            level: "amber",
            reason: `Connection created but never synced (expected every ${formatExpectedSyncInterval(expectedInterval)})`,
          });
        }

        // Check 3: Auth expiry — check metadata.tokenExpiresAt
        const tokenExpiresAt = (conn.metadata as Record<string, unknown> | null)?.tokenExpiresAt;
        if (tokenExpiresAt && typeof tokenExpiresAt === "string") {
          const expiryDate = new Date(tokenExpiresAt);
          const daysUntilExpiry = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
          if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
            results.push({
              connectionId: conn.id,
              companyId: conn.companyId,
              provider: conn.provider,
              level: "auth_expiry",
              reason: `Auth token expires in ${Math.ceil(daysUntilExpiry)} days`,
            });
          } else if (daysUntilExpiry <= 0) {
            results.push({
              connectionId: conn.id,
              companyId: conn.companyId,
              provider: conn.provider,
              level: "auth_expiry",
              reason: "Auth token has expired — re-authorization required",
            });
          }
        }
      }

      return results;
    });

    // Step 3: Create notifications for new alerts (avoid duplicates)
    const created = await step.run("create-notifications", async () => {
      if (alerts.length === 0) return 0;

      // Batch fetch all existing unresolved notifications for alerted connections
      const alertConnectionIds = [...new Set(alerts.map((a) => a.connectionId))];
      const existingNotifs = await db
        .select({
          connectionId: notifications.connectionId,
          type: notifications.type,
        })
        .from(notifications)
        .where(
          and(
            inArray(notifications.connectionId, alertConnectionIds),
            isNull(notifications.resolvedAt)
          )
        );

      const existingSet = new Set(
        existingNotifs.map((n) => `${n.connectionId}:${n.type}`)
      );

      let count = 0;
      for (const alert of alerts) {
        const notifType = alert.level === "amber" ? "sync_amber" : alert.level === "red" ? "sync_red" : "auth_expiry";
        const key = `${alert.connectionId}:${notifType}`;

        if (!existingSet.has(key)) {
          const severity = alert.level === "red" || (alert.level === "auth_expiry" && alert.reason.includes("expired"))
            ? "critical"
            : "warning";

          await db.insert(notifications).values({
            companyId: alert.companyId,
            type: notifType,
            severity,
            title: buildAlertTitle(alert.provider, alert.level),
            message: alert.reason,
            connectionId: alert.connectionId,
          });
          existingSet.add(key);
          count++;
        }
      }

      return count;
    });

    // Step 4: Auto-resolve notifications for recovered connections
    const resolved = await step.run("resolve-recovered", async () => {
      // Find all unresolved sync alerts (not auth_expiry — those need manual re-auth)
      const unresolvedNotifs = await db
        .select({
          id: notifications.id,
          connectionId: notifications.connectionId,
        })
        .from(notifications)
        .where(
          and(
            isNull(notifications.resolvedAt),
            inArray(notifications.type, ["sync_amber", "sync_red"])
          )
        );

      const alertedConnectionIds = new Set(alerts.map((a) => a.connectionId));
      let resolvedCount = 0;

      for (const notif of unresolvedNotifs) {
        // If this connection is no longer in the alerts list, it recovered
        if (notif.connectionId && !alertedConnectionIds.has(notif.connectionId)) {
          await db
            .update(notifications)
            .set({ resolvedAt: new Date() })
            .where(eq(notifications.id, notif.id));
          resolvedCount++;
        }
      }

      return resolvedCount;
    });

    return { checked: activeConnections.length, newAlerts: created, resolved };
  }
);
