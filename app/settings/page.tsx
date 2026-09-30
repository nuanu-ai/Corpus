import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SettingsTabs } from "./_components/settings-tabs";

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const [userRow] = await db
    .select({ tier: users.tier, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return (
    <SettingsTabs
      user={{
        ...session.user,
        tier: userRow?.tier ?? "managed",
        createdAt: userRow?.createdAt?.toISOString() ?? null,
      }}
    />
  );
}
