import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { generateUniqueIngestAddress } from "@/lib/email-ingest";

const EMAIL_INGEST_MANAGER_ROLES = new Set(["owner", "admin"]);

const senderAllowlistSchema = z.object({
  allowedSenders: z.union([z.array(z.string()), z.string()]).optional(),
  allowAllSenders: z.boolean().optional(),
}).strict();

class SenderAllowlistValidationError extends Error {}

function canManageEmailIngest(role: string): boolean {
  return EMAIL_INGEST_MANAGER_ROLES.has(role);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSettingsToken(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null;
  }

  const token = (settings as Record<string, unknown>).ingestToken;
  return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
}

function normalizeAllowedSenders(input: string[] | string | undefined): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\n,]+/g)
      : [];
  const normalized = raw
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));

  if (unique.length > 100) {
    throw new SenderAllowlistValidationError("Sender allowlist supports up to 100 entries");
  }

  for (const entry of unique) {
    if (entry === "*") {
      throw new SenderAllowlistValidationError("Use allowAllSenders instead of wildcard sender entries");
    }
    const isDomain = /^@?[a-z0-9.-]+\.[a-z]{2,}$/i.test(entry);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(entry);
    if (!isDomain && !isEmail) {
      throw new SenderAllowlistValidationError(`Invalid sender allowlist entry: ${entry}`);
    }
  }

  return unique;
}

function readSenderAllowlist(settings: Record<string, unknown>) {
  const emailIngest = asRecord(settings.emailIngest);
  const allowedSenders = Array.isArray(emailIngest.allowedSenders)
    ? emailIngest.allowedSenders.filter((entry): entry is string => typeof entry === "string")
    : Array.isArray(emailIngest.senderAllowlist)
      ? emailIngest.senderAllowlist.filter((entry): entry is string => typeof entry === "string")
      : [];
  const allowAllSenders =
    emailIngest.allowAllSenders === true ||
    emailIngest.allowAll === true ||
    settings.emailIngestAllowAllSenders === true;

  return {
    allowedSenders,
    allowAllSenders,
    configured: allowAllSenders || allowedSenders.length > 0,
  };
}

async function loadCompanySettings(companyId: string) {
  const [company] = await db
    .select({
      settings: companies.settings,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) {
    throw new Error("Company not found");
  }

  return asRecord(company.settings);
}

function buildEmailIngestResponse(input: {
  token: string;
  rotated: boolean;
  settings: Record<string, unknown>;
}) {
  return {
    provider: "email_ingest" as const,
    address: `${input.token}@ingest.corpus.example`,
    token: input.token,
    rotated: input.rotated,
    senderAllowlist: readSenderAllowlist(input.settings),
  };
}

async function ensureEmailIngestAddress(companyId: string, rotate = false) {
  const currentSettings = await loadCompanySettings(companyId);

  const existingToken = rotate ? null : readSettingsToken(currentSettings);
  if (existingToken) {
    return buildEmailIngestResponse({
      token: existingToken,
      rotated: false,
      settings: currentSettings,
    });
  }

  const nextAddress = await generateUniqueIngestAddress(companyId);

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
    .where(eq(companies.id, companyId));

  return buildEmailIngestResponse({
    token: nextAddress.token,
    rotated: true,
    settings: { ...currentSettings, ingestToken: nextAddress.token },
  });
}

export async function GET() {
  try {
    const { companyId } = await getSessionCompanyContext();
    const result = await ensureEmailIngestAddress(companyId, false);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SenderAllowlistValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleApiError(err);
  }
}

export async function POST() {
  try {
    const { companyId, role } = await getSessionCompanyContext();
    if (!canManageEmailIngest(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await ensureEmailIngestAddress(companyId, true);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const { companyId, role } = await getSessionCompanyContext();
    if (!canManageEmailIngest(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = senderAllowlistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid email ingest sender allowlist payload" },
        { status: 400 },
      );
    }

    const allowedSenders = normalizeAllowedSenders(parsed.data.allowedSenders);
    const currentSettings = await loadCompanySettings(companyId);
    let token = readSettingsToken(currentSettings);
    let rotated = false;
    if (!token) {
      const nextAddress = await generateUniqueIngestAddress(companyId);
      token = nextAddress.token;
      rotated = true;
    }

    const nextEmailIngest = {
      ...asRecord(currentSettings.emailIngest),
      allowedSenders,
      allowAllSenders: parsed.data.allowAllSenders === true,
    };

    // DATA-3: path-scoped writes — touch only settings.ingestToken and
    // settings.emailIngest, leaving all sibling sub-objects untouched.
    await db
      .update(companies)
      .set({
        settings: sql`
          jsonb_set(
            jsonb_set(
              COALESCE(${companies.settings}, '{}'::jsonb),
              '{ingestToken}',
              ${JSON.stringify(token)}::jsonb,
              true
            ),
            '{emailIngest}',
            COALESCE(${companies.settings} -> 'emailIngest', '{}'::jsonb)
              || ${JSON.stringify(nextEmailIngest)}::jsonb,
            true
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    return NextResponse.json(buildEmailIngestResponse({
      token,
      rotated,
      settings: { ...currentSettings, ingestToken: token, emailIngest: nextEmailIngest },
    }));
  } catch (err) {
    if (err instanceof SenderAllowlistValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleApiError(err);
  }
}
