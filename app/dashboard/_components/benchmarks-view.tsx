"use client";

import { BarChart3 } from "lucide-react";
import { EmptyState } from "./empty-state";

export function BenchmarksView() {
  return (
    <EmptyState
      icon={BarChart3}
      title="Connect sources to see benchmarks"
      description="Once you connect your financial accounts, we'll compare your metrics against anonymized peer data to show where you stand."
      actionLabel="Connect a source"
      actionHref="/integrations"
    />
  );
}
