import { Inbox } from "lucide-react";

import { PersonalOperatingNav } from "@/app/personal/_components/personal-operating-nav";
import { PersonalSignalsPanel } from "@/app/personal/_components/personal-signals-panel";
import { PersonalSummarySurface } from "@/app/personal/_components/personal-summary-surface";

export default function PersonalInboxPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <Inbox className="size-3.5" />
          Personal inbox
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Personal inbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review personal intake that has not yet been fully resolved, promoted, or cleared.
          </p>
        </div>
      </div>

      <PersonalOperatingNav />
      <PersonalSummarySurface
        domain="inbox"
        emptyLabel="No personal inbox summary has been materialized yet."
      />
      <PersonalSignalsPanel />
    </div>
  );
}
