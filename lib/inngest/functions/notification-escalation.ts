import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { and, eq, isNull, isNotNull, lt } from "drizzle-orm";
import {
  getCompanyOwnerEmail,
  sendNotificationEmail,
} from "@/lib/notifications";

/** Build email body for a notification. */
export function buildEmailBody(
  notif: { title: string; message: string; severity: string; type: string },
  isFollowUp: boolean
): string {
  const urgency =
    notif.severity === "critical"
      ? "This requires immediate attention."
      : "Please review when possible.";
  const followUpNote = isFollowUp
    ? "This is a follow-up reminder. The issue below has not been resolved.\n\n"
    : "";

  return `${followUpNote}${notif.title}

${notif.message}

Severity: ${notif.severity.toUpperCase()}
Type: ${notif.type}

${urgency}

View your dashboard: ${process.env.NEXT_PUBLIC_APP_URL || "https://corpus.example"}/dashboard

— Corpus`;
}

export const notificationEscalation = inngest.createFunction(
  { id: "notification-escalation" },
  { cron: "0 * * * *" }, // every hour
  async ({ step }) => {
    const now = new Date();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Step 1: Find candidates for first email (unread, no email sent, created > 4h ago)
    const firstEmailCandidates = await step.run(
      "find-first-email-candidates",
      async () => {
        return db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.isRead, false),
              isNull(notifications.emailSentAt),
              isNull(notifications.resolvedAt),
              lt(notifications.createdAt, fourHoursAgo)
            )
          );
      }
    );

    // Step 2: Find candidates for follow-up email (email sent, no follow-up, created > 24h ago)
    const followUpCandidates = await step.run(
      "find-follow-up-candidates",
      async () => {
        return db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.isRead, false),
              isNotNull(notifications.emailSentAt),
              isNull(notifications.followUpSentAt),
              isNull(notifications.resolvedAt),
              lt(notifications.createdAt, twentyFourHoursAgo)
            )
          );
      }
    );

    // Step 3: Send first emails
    const firstEmailsSent = await step.run("send-first-emails", async () => {
      let count = 0;
      for (const notif of firstEmailCandidates) {
        const email = await getCompanyOwnerEmail(notif.companyId);
        if (!email) continue;

        const subject = `[Corpus] ${notif.severity === "critical" ? "URGENT: " : ""}${notif.title}`;
        const body = buildEmailBody(notif, false);

        const sent = await sendNotificationEmail(email, subject, body);
        if (sent) {
          await db
            .update(notifications)
            .set({ emailSentAt: new Date() })
            .where(eq(notifications.id, notif.id));
          count++;
        }
      }
      return count;
    });

    // Step 4: Send follow-up emails
    const followUpsSent = await step.run("send-follow-ups", async () => {
      let count = 0;
      for (const notif of followUpCandidates) {
        const email = await getCompanyOwnerEmail(notif.companyId);
        if (!email) continue;

        const subject = `[Corpus] Follow-up: ${notif.title}`;
        const body = buildEmailBody(notif, true);

        const sent = await sendNotificationEmail(email, subject, body);
        if (sent) {
          await db
            .update(notifications)
            .set({ followUpSentAt: new Date() })
            .where(eq(notifications.id, notif.id));
          count++;
        }
      }
      return count;
    });

    return { firstEmailsSent, followUpsSent };
  }
);
