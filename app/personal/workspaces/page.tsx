import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BriefcaseBusiness } from "lucide-react";

import { PersonalOperatingNav } from "@/app/personal/_components/personal-operating-nav";
import { PersonalSummarySurface } from "@/app/personal/_components/personal-summary-surface";
import { PersonalWorkspacesView } from "@/app/personal/_components/personal-workspaces-view";
import { auth } from "@/lib/auth";
import {
  loadPersonalLinkedWorkspaces,
  type PersonalSurfaceContext,
} from "@/lib/company-db/personal-surfaces";
import { getSessionPersonalProjectContext } from "@/lib/api-auth";

export default async function PersonalWorkspacesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const personalAuth = await getSessionPersonalProjectContext();
  const context: PersonalSurfaceContext = {
    tenantId: personalAuth.projectId,
    userId: personalAuth.userId,
    role: personalAuth.role,
  };
  const linkedWorkspaces = await loadPersonalLinkedWorkspaces(context);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <BriefcaseBusiness className="size-3.5" />
          Personal workspaces
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Personal view over linked company contexts, responsibilities, and explicit drill-down points into live company workspaces.
          </p>
        </div>
      </div>

      <PersonalOperatingNav />
      <PersonalSummarySurface
        domain="workspaces"
        emptyLabel="No personal workspaces summary has been materialized yet."
      />
      <PersonalWorkspacesView workspaces={linkedWorkspaces} />
    </div>
  );
}
