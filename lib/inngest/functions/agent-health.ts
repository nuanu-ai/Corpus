import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, notifications } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest";

/**
 * Cron guardrail for the chat agent runtime.
 * If Anthropic key is missing, creates critical notifications per company.
 * If key becomes available again, auto-resolves those notifications.
 */
export const agentHealthCheck = inngest.createFunction(
  { id: "agent-health-check" },
  { cron: "0 * * * *" }, // hourly
  async ({ step }) => {
    const hasApiKey = await step.run("check-anthropic-key", async () =>
      Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()),
    );

    const allCompanies = await step.run("list-companies", async () =>
      db.select({ id: companies.id }).from(companies),
    );

    if (allCompanies.length === 0) {
      return { ok: true, companies: 0, hasApiKey };
    }

    const companyIds = allCompanies.map((company) => company.id);

    const openAlerts = await step.run("list-open-agent-alerts", async () =>
      db
        .select({ id: notifications.id, companyId: notifications.companyId })
        .from(notifications)
        .where(
          and(
            eq(notifications.type, "agent_unavailable"),
            inArray(notifications.companyId, companyIds),
            isNull(notifications.resolvedAt),
          ),
        ),
    );

    if (!hasApiKey) {
      const alertedCompanyIds = new Set(openAlerts.map((row) => row.companyId));
      const missingCompanyIds = companyIds.filter((id) => !alertedCompanyIds.has(id));

      if (missingCompanyIds.length > 0) {
        await step.run("create-agent-alerts", async () => {
          await db.insert(notifications).values(
            missingCompanyIds.map((companyId) => ({
              companyId,
              type: "agent_unavailable",
              severity: "critical",
              title: "AI agent unavailable",
              message:
                "ANTHROPIC_API_KEY is missing. Chat agent cannot respond until API key is configured.",
              isRead: false,
            })),
          );
        });
      }

      return {
        ok: false,
        hasApiKey: false,
        companies: companyIds.length,
        alertsOpen: openAlerts.length + missingCompanyIds.length,
      };
    }

    if (openAlerts.length > 0) {
      const alertIds = openAlerts.map((row) => row.id);
      await step.run("resolve-agent-alerts", async () => {
        await db
          .update(notifications)
          .set({ resolvedAt: new Date(), severity: "info" })
          .where(inArray(notifications.id, alertIds));
      });
    }

    return {
      ok: true,
      hasApiKey: true,
      companies: companyIds.length,
      alertsResolved: openAlerts.length,
    };
  },
);
