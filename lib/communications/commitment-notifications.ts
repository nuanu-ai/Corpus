import type {
  CommitmentEscalationLevel,
  DashboardCommitmentItem,
} from "@/lib/communications/commitments";

export const COMMITMENT_NOTIFICATION_TYPES = [
  "commitment_overdue_l1",
  "commitment_overdue_l2",
  "commitment_overdue_l3",
] as const;

export function buildCommitmentNotificationReference(filePath: string): string {
  return `commitment_ref:${filePath}`;
}

export function extractCommitmentNotificationReference(
  message: string,
): string | null {
  const match = message.match(/commitment_ref:([^\n]+)/);
  return match ? `commitment_ref:${match[1]}` : null;
}

export function commitmentNotificationTypeForLevel(
  level: CommitmentEscalationLevel,
): (typeof COMMITMENT_NOTIFICATION_TYPES)[number] {
  return `commitment_overdue_${level}` as const;
}

export function buildCommitmentEscalationNotification(input: {
  companyId: string;
  item: DashboardCommitmentItem;
  level: CommitmentEscalationLevel;
}) {
  const dueLabel = input.item.dueDate ?? input.item.dueDateLabel ?? "undated";
  const reference = buildCommitmentNotificationReference(input.item.filePath);

  return {
    companyId: input.companyId,
    type: commitmentNotificationTypeForLevel(input.level),
    severity:
      input.level === "l3"
        ? "critical"
        : input.level === "l2"
          ? "warning"
          : "info",
    title: `${input.item.title} overdue (${input.level.toUpperCase()})`,
    message: [
      `Commitment from ${input.item.threadLabel ?? "connected chat"} is still open.`,
      `Due: ${dueLabel}`,
      `Reference: ${reference}`,
    ].join("\n"),
    isRead: false,
  } as const;
}
