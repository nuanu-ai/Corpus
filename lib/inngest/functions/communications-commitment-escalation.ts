import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  queryAllEntities,
  readQmdFile,
  submitCommunicationsCommit,
} from "@/lib/company-db/client";
import type { EntityResult } from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import {
  buildCommitmentEscalationNotification,
  buildCommitmentNotificationReference,
  COMMITMENT_NOTIFICATION_TYPES,
  extractCommitmentNotificationReference,
} from "@/lib/communications/commitment-notifications";
import { determineCommitmentEscalationLevel } from "@/lib/communications/commitment-lifecycle";
import { toCommitmentSignalCandidate } from "@/lib/communications/commitments";
import { applyCommitmentLifecycleToSignalQmd } from "@/lib/communications/qmd";
import { db } from "@/lib/db";
import { companies, notifications } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest";

function todayUtcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export const communicationsCommitmentEscalation = inngest.createFunction(
  { id: "communications-commitment-escalation" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    const companyRows = await step.run(
      "list-companies-for-commitment-escalation",
      async () =>
        db
          .select({
            id: companies.id,
            slug: companies.slug,
            companyDbPort: companies.companyDbPort,
          })
          .from(companies)
          .where(eq(companies.tenantKind, "company")),
    );

    const todayDayKey = todayUtcDayKey();
    const results: Array<Record<string, unknown>> = [];

    for (const company of companyRows) {
      if (!company.slug) continue;

      const records = await step.run(
        `load-commitment-signals-${company.id}`,
        async () =>
          queryAllEntities(
            {
              domain: "communications",
              type: "communication_signal",
              view: "summary",
            },
            {
              companySlug: company.slug!,
              callerId: `communications-escalation-${company.slug}`,
              callerRole: "cfo_agent",
              port: company.companyDbPort,
            },
          ).catch(() => []),
      );

      const items = (records as EntityResult[])
        .map((record) => toCommitmentSignalCandidate(record))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter(
          (item) => item.provider === "telegram" && item.status === "open",
        );

      const openNotifications = await step.run(
        `load-open-commitment-notifications-${company.id}`,
        async () =>
          db
            .select({
              id: notifications.id,
              type: notifications.type,
              message: notifications.message,
            })
            .from(notifications)
            .where(
              and(
                eq(notifications.companyId, company.id),
                inArray(notifications.type, [...COMMITMENT_NOTIFICATION_TYPES]),
                isNull(notifications.resolvedAt),
              ),
            ),
      );

      const notificationByRef = new Map<
        string,
        Array<{ id: string; type: string }>
      >();
      for (const row of openNotifications) {
        const reference = extractCommitmentNotificationReference(row.message);
        if (!reference) continue;
        const bucket = notificationByRef.get(reference) ?? [];
        bucket.push({ id: row.id, type: row.type });
        notificationByRef.set(reference, bucket);
      }

      const filesToWrite: Array<{ path: string; content: string }> = [];
      const notificationIdsToResolve = new Set<string>();
      const notificationsToCreate: Array<
        ReturnType<typeof buildCommitmentEscalationNotification>
      > = [];

      for (const item of items) {
        const targetLevel = determineCommitmentEscalationLevel({
          dueDate: item.dueDate,
          todayDayKey,
        });
        const reference = buildCommitmentNotificationReference(item.filePath);
        const relatedNotifications = notificationByRef.get(reference) ?? [];

        if (item.escalationLevel === targetLevel) continue;

        const rawSignal = await readQmdFile(item.filePath, {
          companySlug: company.slug,
          callerId: `communications-escalation-${company.slug}`,
          callerRole: "cfo_agent",
          port: company.companyDbPort,
        }).catch(() => null);
        if (!rawSignal) continue;

        filesToWrite.push({
          path: item.filePath,
          content: applyCommitmentLifecycleToSignalQmd(rawSignal, {
            escalationLevel: targetLevel,
            lastEscalatedAt: targetLevel ? new Date().toISOString() : null,
          }),
        });

        for (const row of relatedNotifications) {
          notificationIdsToResolve.add(row.id);
        }

        if (targetLevel) {
          notificationsToCreate.push(
            buildCommitmentEscalationNotification({
              companyId: company.id,
              item,
              level: targetLevel,
            }),
          );
        }
      }

      if (filesToWrite.length > 0) {
        await step.run(
          `commit-commitment-escalation-${company.id}`,
          async () => {
            await submitCommunicationsCommit(
              company.slug!,
              {
                domain: "communications",
                files: filesToWrite,
                commitMessage: `communications(commitments): escalation ${todayDayKey}`,
                metadata: {
                  reason: "communications_commitment_escalation",
                  todayDayKey,
                },
              },
              company.companyDbPort + 1,
            );
          },
        );

        await step.run(
          `refresh-communications-summary-${company.id}`,
          async () =>
            refreshSummaryTargets({
              companySlug: company.slug!,
              port: company.companyDbPort,
              writeQueuePort: company.companyDbPort + 1,
              domains: ["communications"],
              reason: "communications_commitment_escalation",
            }).catch(() => null),
        );
      }

      if (notificationIdsToResolve.size > 0) {
        await step.run(
          `resolve-commitment-notifications-${company.id}`,
          async () => {
            await db
              .update(notifications)
              .set({ resolvedAt: new Date() })
              .where(
                inArray(notifications.id, Array.from(notificationIdsToResolve)),
              );
          },
        );
      }

      if (notificationsToCreate.length > 0) {
        await step.run(
          `create-commitment-notifications-${company.id}`,
          async () => {
            await db.insert(notifications).values(notificationsToCreate);
          },
        );
      }

      results.push({
        companyId: company.id,
        filesUpdated: filesToWrite.length,
        notificationsResolved: notificationIdsToResolve.size,
        notificationsCreated: notificationsToCreate.length,
      });
    }

    return {
      companiesProcessed: results.length,
      todayDayKey,
      results,
    };
  },
);
