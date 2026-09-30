import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { listUserApiKeys } from "@/lib/auth/user-api-keys";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

import { ByokKeysClient } from "./byok-keys-client";

export default async function ByokSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login?next=/settings/byok");

  const userId = session.user.id;

  const [userRow] = await db
    .select({ tier: users.tier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const tier = userRow?.tier ?? "managed";
  const initialKeys = await listUserApiKeys(userId);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Provider keys</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Bring your own OpenAI / Codex credentials. The system uses your key
          when you send chat messages, transcribe voice, or upload documents.
        </p>
      </div>
      <ByokKeysClient tier={tier} initialKeys={initialKeys} />
    </div>
  );
}
