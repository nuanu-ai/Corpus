"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCFOStore } from "@/lib/store";
import {
  useNotificationsData,
  type Notification,
} from "@/lib/hooks/use-financial-data";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  CheckCircle2,
  Loader2,
} from "lucide-react";

/** Simple relative-time formatter (no date-fns dependency). */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.round((now - then) / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo ago`;
}

const SEVERITY_COLORS = {
  warning: {
    iconBg: "bg-yellow-500/10 text-yellow-500",
    badge:
      "text-yellow-600 border-yellow-600/30 dark:text-yellow-500 dark:border-yellow-500/30",
  },
  critical: {
    iconBg: "bg-yellow-500/10 text-yellow-500",
    badge:
      "text-yellow-600 border-yellow-600/30 dark:text-yellow-500 dark:border-yellow-500/30",
  },
  info: {
    iconBg: "bg-blue-500/10 text-blue-500",
    badge:
      "text-blue-600 border-blue-600/30 dark:text-blue-400 dark:border-blue-400/30",
  },
} as const;

function getSeverityColors(severity: string) {
  return (
    SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] ??
    SEVERITY_COLORS.info
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "warning" || severity === "critical") {
    return <AlertTriangle className="size-4" />;
  }
  return <Bell className="size-4" />;
}

function AlertRow({
  notification,
  isExpanded,
  onToggle,
}: {
  notification: Notification;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const colors = getSeverityColors(notification.severity);

  return (
    <Card
      className={`transition-all duration-200 ${
        isExpanded
          ? "ring-1 ring-border"
          : "hover:bg-accent/50 cursor-pointer"
      }`}
    >
      <CardContent
        className="flex items-start gap-3 py-3 cursor-pointer"
        onClick={onToggle}
      >
        <div
          className={`mt-0.5 size-8 rounded-lg flex items-center justify-center shrink-0 ${colors.iconBg}`}
        >
          <SeverityIcon severity={notification.severity} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{notification.title}</p>
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${colors.badge}`}
            >
              {notification.severity}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {notification.message}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground/60">
            {timeAgo(notification.createdAt)}
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground/40 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </CardContent>

      <div
        className={`overflow-hidden transition-all duration-200 ${
          isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="px-6 pb-4 pt-1 border-t border-border/50">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
            {notification.message}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function Alerts() {
  const selectedAlertId = useCFOStore((s) => s.selectedAlertId);
  const setSelectedAlertId = useCFOStore((s) => s.setSelectedAlertId);
  const { data: notifications, isLoading } = useNotificationsData();

  const handleAlertClick = (id: string) => {
    setSelectedAlertId(selectedAlertId === id ? null : id);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Alerts
        </h3>
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          <span className="text-xs">Loading...</span>
        </div>
      </div>
    );
  }

  // Empty state (no notifications, or auth failed → null data)
  if (!notifications || notifications.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Alerts
        </h3>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="size-8 rounded-lg flex items-center justify-center shrink-0 bg-green-500/10 text-green-500">
              <CheckCircle2 className="size-4" />
            </div>
            <p className="text-sm text-muted-foreground">
              No alerts &mdash; everything looks good
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground px-1">
        Alerts
      </h3>
      <div className="grid gap-2">
        {notifications.map((n) => (
          <AlertRow
            key={n.id}
            notification={n}
            isExpanded={selectedAlertId === n.id}
            onToggle={() => handleAlertClick(n.id)}
          />
        ))}
      </div>
    </div>
  );
}
