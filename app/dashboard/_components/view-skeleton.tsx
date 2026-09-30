"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Generic card skeleton for loading states */
export function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}

/** Grid of metric skeletons */
export function MetricGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="py-4">
          <CardContent>
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-7 w-16 mb-1" />
            <Skeleton className="h-3 w-12" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Chart area skeleton */
export function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[280px] w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

/** List item skeletons */
export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Combines multiple skeleton types into a full view loading state */
export function ViewSkeleton({
  variant = "default",
}: {
  variant?: "default" | "metrics" | "chart" | "list";
}) {
  if (variant === "list") {
    return (
      <div className="space-y-4">
        <ListSkeleton count={4} />
      </div>
    );
  }

  if (variant === "metrics") {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <MetricGridSkeleton count={4} />
        <ChartSkeleton />
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div className="space-y-4">
        <MetricGridSkeleton count={4} />
        <ChartSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CardSkeleton />
      <ChartSkeleton />
      <ListSkeleton count={3} />
    </div>
  );
}
