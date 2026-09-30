import { redirect } from "next/navigation";

import { PlatformObservatory } from "./_components/platform-observatory";
import { getPlatformAdminSession } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getPlatformAdminSession();
  if (!session?.user) {
    redirect("/dashboard");
  }

  return <PlatformObservatory />;
}
