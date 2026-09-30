import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MyCompaniesScreen } from "@/app/settings/_components/my-companies-screen";
import { auth } from "@/lib/auth";

export default async function SettingsCompaniesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login?next=/settings/companies");

  return <MyCompaniesScreen />;
}
