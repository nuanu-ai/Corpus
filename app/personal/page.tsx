import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Building2, Database, Link2, User } from "lucide-react";
import Link from "next/link";

import { PersonalOperatingNav } from "@/app/personal/_components/personal-operating-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { getPersonalProjectForUser } from "@/lib/personal-projects";
import { listCompanyMemberships } from "@/lib/db/tenant";

export default async function PersonalPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const [personalProject, companyMemberships] = await Promise.all([
    getPersonalProjectForUser(session.user.id),
    listCompanyMemberships(session.user.id),
  ]);

  if (!personalProject) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <User className="size-3.5" />
          Personal project
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{personalProject.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            This is your personal database workspace. It is provisioned separately from company tenants and is ready for personal notes, linked company context, personal documents, and future personal assistant flows.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4" />
              Schema pack
            </CardTitle>
            <CardDescription>Current tenant kernel mode</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="font-medium">person</div>
            <div className="text-muted-foreground">git-backed personal workspace</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="size-4" />
              Linked companies
            </CardTitle>
            <CardDescription>Company workspaces you can reason over</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="font-medium">{companyMemberships.length}</div>
            <div className="text-muted-foreground">
              Company tenants remain separate truth stores.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4" />
              Personal tenant
            </CardTitle>
            <CardDescription>Provisioned runtime state</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="font-medium">Live</div>
            <div className="text-muted-foreground">Port {personalProject.companyDbPort}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What is live now</CardTitle>
          <CardDescription>
            The personal project is auto-created, visible in the project switcher, provisioned with the person schema pack, and now has a dedicated personal documents surface.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>- company workspaces still use the existing company-only runtime and cookies</p>
          <p>- personal project uses a separate active-project context</p>
          <p>- company routes are intentionally not re-bound to personal data in this rollout</p>
          <div className="pt-2">
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/personal/chat">Open personal chat</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/personal/documents">Open personal documents</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/personal/integrations">Open personal integrations</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Operating surfaces</h2>
          <p className="text-sm text-muted-foreground">
            Personal inbox, today, timeline, workspaces, and commitments now read from the person schema pack without rebinding company routes.
          </p>
        </div>
        <PersonalOperatingNav />
      </div>
    </div>
  );
}
