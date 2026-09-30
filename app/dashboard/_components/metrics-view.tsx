"use client";

import { Activity } from "lucide-react";
import { useMetricsData, hasData } from "@/lib/hooks/use-financial-data";
import { EmptyState } from "./empty-state";
import { ViewSkeleton } from "./view-skeleton";

export function MetricsView() {
  const { data, isLoading } = useMetricsData();

  if (isLoading) {
    return <ViewSkeleton variant="metrics" />;
  }

  if (!hasData(data)) {
    return (
      <EmptyState
        icon={Activity}
        title="No metrics available"
        description="Connect your accounts and import financial data to see health scores, unit economics, revenue metrics, and cash forecasts."
        actionLabel="Connect a source"
        actionHref="/integrations"
      />
    );
  }

  // When real data is available, this will render the full metrics dashboard.
  // For v1, most users will see the empty state above.
  return (
    <EmptyState
      icon={Activity}
      title="Metrics coming soon"
      description="We're building advanced financial metrics. Connect your accounts now so data is ready when this feature launches."
      actionLabel="Connect a source"
      actionHref="/integrations"
    />
  );
}
