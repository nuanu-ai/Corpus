import { db } from "@/lib/db";
import { notifications, companyMembers, users } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(notificationId: string, companyId: string): Promise<boolean> {
  const [updated] = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.companyId, companyId)
      )
    )
    .returning({ id: notifications.id });
  return !!updated;
}

/**
 * Mark all notifications as read for a company.
 */
export async function markAllRead(companyId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.companyId, companyId),
        eq(notifications.isRead, false),
        isNull(notifications.resolvedAt)
      )
    )
    .returning({ id: notifications.id });
  return result.length;
}

/**
 * Get unread notification count for a company.
 */
export async function getUnreadCount(companyId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, companyId),
        eq(notifications.isRead, false),
        isNull(notifications.resolvedAt)
      )
    );
  return rows.length;
}

/**
 * Get the email address for the company owner.
 * Used by the escalation function to send emails.
 */
export async function getCompanyOwnerEmail(companyId: string): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.role, "owner")
      )
    )
    .limit(1);
  return rows[0]?.email ?? null;
}

/**
 * Stub: Send notification email.
 * In production, this would use SendGrid/Resend. For now, logs and returns true.
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  // TODO: Replace with actual email sending via SendGrid/Resend
  console.log(`[EMAIL] To: ${to}, Subject: ${subject}, Body: ${body}`);
  return true;
}
