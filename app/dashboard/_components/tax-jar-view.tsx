"use client";

import { Shield } from "lucide-react";
import { useTaxData, hasData } from "@/lib/hooks/use-financial-data";
import { EmptyState } from "./empty-state";
import { ViewSkeleton } from "./view-skeleton";

export function TaxJarView() {
  const { data, isLoading } = useTaxData();

  if (isLoading) {
    return <ViewSkeleton variant="metrics" />;
  }

  if (!hasData(data)) {
    return (
      <EmptyState
        icon={Shield}
        title="No tax data yet"
        description="Connect your accounts and import revenue data to automatically calculate tax reserves and track quarterly obligations."
        actionLabel="Connect a source"
        actionHref="/integrations"
      />
    );
  }

  // When real data is available, this will render the full tax jar dashboard.
  // For v1, most users will see the empty state above.
  return (
    <EmptyState
      icon={Shield}
      title="Tax Jar coming soon"
      description="We're building automatic tax reserve calculations. Connect your accounts now so data is ready when this feature launches."
      actionLabel="Connect a source"
      actionHref="/integrations"
    />
  );
}
