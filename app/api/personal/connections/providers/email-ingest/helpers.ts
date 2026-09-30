import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { generateUniqueIngestAddress } from "@/lib/email-ingest";

export function readSettingsToken(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null;
  }

  const token = (settings as Record<string, unknown>).ingestToken;
  return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
}

export async function ensurePersonalEmailIngestAddress(projectId: string, rotate = false) {
  const [project] = await db
    .select({
      settings: companies.settings,
      tenantKind: companies.tenantKind,
    })
    .from(companies)
    .where(eq(companies.id, projectId))
    .limit(1);

  if (!project) {
    throw new Error("Personal project not found");
  }

  if (project.tenantKind !== "person") {
    throw new Error("Personal email forwarding requires a personal project tenant");
  }

  const currentSettings =
    project.settings && typeof project.settings === "object" && !Array.isArray(project.settings)
      ? (project.settings as Record<string, unknown>)
      : {};

  const existingToken = rotate ? null : readSettingsToken(currentSettings);
  if (existingToken) {
    return {
      provider: "email_ingest" as const,
      address: `${existingToken}@ingest.corpus.example`,
      token: existingToken,
      rotated: false,
    };
  }

  const nextAddress = await generateUniqueIngestAddress(projectId);

  // DATA-3: path-scoped write — only touch settings.ingestToken.
  await db
    .update(companies)
    .set({
      settings: sql`
        jsonb_set(
          COALESCE(${companies.settings}, '{}'::jsonb),
          '{ingestToken}',
          ${JSON.stringify(nextAddress.token)}::jsonb,
          true
        )
      `,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, projectId));

  return {
    provider: "email_ingest" as const,
    address: nextAddress.full,
    token: nextAddress.token,
    rotated: true,
  };
}
