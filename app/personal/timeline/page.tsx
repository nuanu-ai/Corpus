import { Rows3 } from "lucide-react";

import { PersonalOperatingNav } from "@/app/personal/_components/personal-operating-nav";
import { PersonalSummarySurface } from "@/app/personal/_components/personal-summary-surface";

export default function PersonalTimelinePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <Rows3 className="size-3.5" />
          Personal timeline
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Timeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Chronological summary for personal events, signals, and linked operating context.
          </p>
        </div>
      </div>

      <PersonalOperatingNav />
      <PersonalSummarySurface
        domain="timeline"
        emptyLabel="No personal timeline summary has been materialized yet."
      />
    </div>
  );
}
