import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { landingLeads } from "@/lib/db/schema";
import { getLandingLocale } from "@/lib/landing-copy";

const ALLOWED_INTENTS = new Set(["team_trial", "holding_contact"]);

function trimText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || null;
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const intent = trimText(payload.intent, 40);
  if (!intent || !ALLOWED_INTENTS.has(intent)) {
    return NextResponse.json({ error: "Invalid lead intent" }, { status: 400 });
  }

  const email = trimText(payload.email, 180)?.toLowerCase();
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const locale = getLandingLocale(trimText(payload.locale, 16));
  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : {};

  const [lead] = await db
    .insert(landingLeads)
    .values({
      intent,
      plan: trimText(payload.plan, 80),
      email,
      name: trimText(payload.name, 140),
      companyName: trimText(payload.companyName, 180),
      message: trimText(payload.message, 1200),
      locale,
      path: trimText(payload.path, 500),
      referrer: trimText(payload.referrer, 500),
      utmSource: trimText(payload.utmSource, 160),
      utmMedium: trimText(payload.utmMedium, 160),
      utmCampaign: trimText(payload.utmCampaign, 220),
      userAgent: trimText(request.headers.get("user-agent"), 500),
      ipAddress: trimText(getClientIp(request), 80),
      metadata,
    })
    .returning({ id: landingLeads.id });

  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}
