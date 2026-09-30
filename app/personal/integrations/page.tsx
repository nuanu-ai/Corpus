import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Mail, PlugZap } from "lucide-react";

import { PersonalIntegrationsView } from "@/app/personal/integrations/_components/personal-integrations-view";
import { auth } from "@/lib/auth";
import { getPersonalProjectForUser } from "@/lib/personal-projects";

export default async function PersonalIntegrationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const personalProject = await getPersonalProjectForUser(session.user.id);
  if (!personalProject) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <PlugZap className="size-3.5" />
          Personal integrations
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Personal integrations</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            This surface is session-only and additive. It does not reuse company integrations routes or expose personal connectors to bearer API keys.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Mail className="size-4" />
          What is live now
        </div>
        <div className="mt-2 space-y-1">
          <p>- personal email forwarding is live and routes attachments into your personal document pipeline</p>
          <p>- personal connector management remains session-only</p>
          <p>- Telegram account connection, chat selection, and per-person analysis context are live</p>
          <p>- automated Telegram message/media ingestion remains gated until the personal communications schema is complete</p>
        </div>
      </div>

      <PersonalIntegrationsView />
    </div>
  );
}
