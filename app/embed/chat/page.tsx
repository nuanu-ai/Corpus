import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { EmbedChatShell } from "./embed-chat-shell";

interface EmbedChatPageProps {
  searchParams: Promise<{
    companyId?: string;
  }>;
}

export default async function EmbedChatPage({ searchParams }: EmbedChatPageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  const params = await searchParams;
  const companyId = typeof params.companyId === "string" ? params.companyId : null;
  const embedHref = companyId ? `/embed/chat?companyId=${encodeURIComponent(companyId)}` : "/embed/chat";
  const loginHref = companyId
    ? `/login?mode=signin&next=${encodeURIComponent(embedHref)}`
    : "/login?mode=signin&next=%2Fembed%2Fchat";

  if (!session?.user) {
    redirect(loginHref);
  }

  return <EmbedChatShell companyId={companyId} />;
}
