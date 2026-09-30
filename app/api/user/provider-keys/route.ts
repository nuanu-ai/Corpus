import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  SUPPORTED_BYOK_PROVIDERS,
  deleteUserApiKey,
  isByokProvider,
  listUserApiKeys,
  setUserApiKey,
} from "@/lib/auth/user-api-keys";

async function requireUserId(): Promise<string | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return userId;
}

export async function GET() {
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const keys = await listUserApiKeys(userId);
  return NextResponse.json({
    supportedProviders: SUPPORTED_BYOK_PROVIDERS,
    keys,
  });
}

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = typeof body.provider === "string" ? body.provider : "";
  const plaintext = typeof body.key === "string" ? body.key : "";
  const label = typeof body.label === "string" ? body.label : null;

  if (!isByokProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${SUPPORTED_BYOK_PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }

  if (!plaintext) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  try {
    const result = await setUserApiKey({
      userId,
      provider,
      plaintext,
      label,
    });
    return NextResponse.json({ key: result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save key";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const removed = await deleteUserApiKey({ userId, id });
  if (!removed) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
