import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyCompanyContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import {
  buildPeoplePayload,
  createPersonProfile,
  deletePersonProfile,
  resolvePeopleCompanyContext,
  updatePersonProfile,
  PeopleRequestError,
} from "@/lib/people/api";

function handlePeopleError(err: unknown) {
  if (err instanceof PeopleRequestError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return handleApiError(err);
}

async function getPeopleContext() {
  const { apiKey, membership } = await getApiKeyCompanyContext();
  const context = await resolvePeopleCompanyContext({
    companyId: membership.companyId,
    callerId: apiKey.userId,
    callerRole: membership.role,
  });
  return { apiKey, membership, context };
}

export async function GET() {
  try {
    const { apiKey, membership, context } = await getPeopleContext();
    requireGrantedApiKeyScope(apiKey.scopes, "people.read");

    const payload = await buildPeoplePayload(context);
    return NextResponse.json({
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
      },
      ...payload,
    });
  } catch (err) {
    return handlePeopleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, membership, context } = await getPeopleContext();
    requireGrantedApiKeyScope(apiKey.scopes, "people.write");

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await createPersonProfile(context, body);
    return NextResponse.json({
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
      },
      ...result,
    });
  } catch (err) {
    return handlePeopleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { apiKey, membership, context } = await getPeopleContext();
    requireGrantedApiKeyScope(apiKey.scopes, "people.write");

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await updatePersonProfile(context, body);
    return NextResponse.json({
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
      },
      ...result,
    });
  } catch (err) {
    return handlePeopleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { apiKey, membership, context } = await getPeopleContext();
    requireGrantedApiKeyScope(apiKey.scopes, "people.write");

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await deletePersonProfile(context, body);
    return NextResponse.json({
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
      },
      ...result,
    });
  } catch (err) {
    return handlePeopleError(err);
  }
}
