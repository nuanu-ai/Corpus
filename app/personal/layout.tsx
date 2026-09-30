import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPersonalProjectForUser } from "@/lib/personal-projects";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PersonalProjectActivator } from "@/app/personal/_components/personal-project-activator";

export default async function PersonalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/login");
  }

  const personalProject = await getPersonalProjectForUser(session.user.id);
  if (!personalProject) {
    redirect("/dashboard");
  }

  return (
    <WorkspaceShell enableGlobalAdd>
      <PersonalProjectActivator />
      {children}
    </WorkspaceShell>
  );
}
