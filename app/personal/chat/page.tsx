import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPersonalProjectForUser } from "@/lib/personal-projects";

import { PersonalChatV2 } from "./_components/personal-chat-v2";

export default async function PersonalChatPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/login");
  }

  const personalProject = await getPersonalProjectForUser(session.user.id);
  if (!personalProject) {
    redirect("/dashboard");
  }

  return <PersonalChatV2 />;
}
