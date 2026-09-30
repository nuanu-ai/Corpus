import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  deleteConnectorRuleDocumentForCompany,
  loadConnectorRuleDocumentForCompany,
  saveConnectorRuleDocumentForCompany,
} from "@/lib/connectors/rule-documents";

function isUnsupportedProviderError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.startsWith("Unsupported connector provider:")
  );
}

function isInvalidRuleContentError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.startsWith("Invalid connector rule file ") ||
      error.message === "Connector rule content is required")
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const auth = await getSessionCompanyContext();
    const { provider } = await context.params;
    const document = await loadConnectorRuleDocumentForCompany({
      companyId: auth.companyId,
      provider,
      callerId: auth.userId,
      callerRole: auth.role,
    });

    return NextResponse.json(document);
  } catch (error) {
    if (isUnsupportedProviderError(error)) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
    }
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const auth = await getSessionCompanyContext();
    const { provider } = await context.params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "content must be a string" },
        { status: 400 },
      );
    }

    await saveConnectorRuleDocumentForCompany({
      companyId: auth.companyId,
      provider,
      content: body.content,
      actorUserId: auth.userId,
      actorRole: auth.role,
    });

    const document = await loadConnectorRuleDocumentForCompany({
      companyId: auth.companyId,
      provider,
      callerId: auth.userId,
      callerRole: auth.role,
    });

    return NextResponse.json(document);
  } catch (error) {
    if (isUnsupportedProviderError(error) || isInvalidRuleContentError(error)) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
    }
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const auth = await getSessionCompanyContext();
    const { provider } = await context.params;

    await deleteConnectorRuleDocumentForCompany({
      companyId: auth.companyId,
      provider,
      actorUserId: auth.userId,
      actorRole: auth.role,
    });

    const document = await loadConnectorRuleDocumentForCompany({
      companyId: auth.companyId,
      provider,
      callerId: auth.userId,
      callerRole: auth.role,
    });

    return NextResponse.json(document);
  } catch (error) {
    if (isUnsupportedProviderError(error)) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
    }
    return handleApiError(error);
  }
}
