import { CalendarDays } from "lucide-react";

import { PersonalOperatingNav } from "@/app/personal/_components/personal-operating-nav";
import { PersonalSummarySurface } from "@/app/personal/_components/personal-summary-surface";

export default function PersonalTodayPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" />
          Personal today
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Read the materialized operating summary for what matters now in your personal tenant.
          </p>
        </div>
      </div>

      <PersonalOperatingNav />
      <PersonalSummarySurface
        domain="today"
        emptyLabel="No personal today summary has been materialized yet."
      />
    </div>
  );
}
