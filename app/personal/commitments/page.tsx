import { ListTodo } from "lucide-react";

import { PersonalCommitmentsView } from "@/app/personal/_components/personal-commitments-view";
import { PersonalOperatingNav } from "@/app/personal/_components/personal-operating-nav";

export default function PersonalCommitmentsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <ListTodo className="size-3.5" />
          Personal commitments
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Commitments</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Promises and deadlines derived from your personal communications and summaries.
          </p>
        </div>
      </div>

      <PersonalOperatingNav />
      <PersonalCommitmentsView />
    </div>
  );
}
