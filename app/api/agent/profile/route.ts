import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  getApiKeyContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export async function GET() {
  try {
    const apiKey = await getApiKeyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "profile.read");

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, apiKey.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ profile: user });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const apiKey = await getApiKeyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "profile.write");

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = stringOrNull(body.name);
    const image = body.image === null ? null : stringOrNull(body.image);

    if (name === null && image === null && body.image !== null) {
      return NextResponse.json(
        { error: "At least one of name or image is required" },
        { status: 400 },
      );
    }

    if (name !== null && name.length > 120) {
      return NextResponse.json(
        { error: "name must be 120 characters or fewer" },
        { status: 400 },
      );
    }

    if (image !== null && image.length > 2048) {
      return NextResponse.json(
        { error: "image must be 2048 characters or fewer" },
        { status: 400 },
      );
    }

    const values: {
      updatedAt: Date;
      name?: string;
      image?: string | null;
    } = {
      updatedAt: new Date(),
    };

    if (name !== null) {
      values.name = name;
    }
    if (body.image === null) {
      values.image = null;
    } else if (image !== null) {
      values.image = image;
    }

    const [updated] = await db
      .update(users)
      .set(values)
      .where(eq(users.id, apiKey.userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ profile: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
