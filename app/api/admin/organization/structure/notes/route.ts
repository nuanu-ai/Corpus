import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import { requireOrganizationStructureAdmin } from "@/lib/operating-structure/admin-auth";
import {
  getFounderAdminNotesForObject,
  isValidFounderAdminNoteObjectId,
  upsertFounderAdminNote,
} from "@/lib/operating-structure/founder-notes";
import { buildOrganizationOperatingStructureModel } from "@/lib/operating-structure/serializer";

function normalizeSourceRefs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function getScopedNoteObject(objectId: string) {
  if (!isValidFounderAdminNoteObjectId(objectId)) {
    return { error: "Invalid objectId" } as const;
  }
  const model = buildOrganizationOperatingStructureModel();
  const object = model.objects.find((entry) => entry.id === objectId);
  if (!object) {
    return { error: "Object not found" } as const;
  }
  return {
    object,
    companyIds: object.appCompanyId ? [object.appCompanyId] : [],
  } as const;
}

export async function GET(req: NextRequest) {
  try {
    await requireOrganizationStructureAdmin();
    const objectId = req.nextUrl.searchParams.get("objectId")?.trim();
    if (!objectId) {
      return NextResponse.json({ error: "objectId is required" }, { status: 400 });
    }

    const scopedObject = getScopedNoteObject(objectId);
    if ("error" in scopedObject) {
      return NextResponse.json(
        { error: scopedObject.error },
        { status: scopedObject.error === "Object not found" ? 404 : 400 },
      );
    }

    const notes = await getFounderAdminNotesForObject(objectId, {
      companyIds: scopedObject.companyIds,
    });
    return NextResponse.json({ notes });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireOrganizationStructureAdmin();
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const objectId = typeof body.objectId === "string" ? body.objectId.trim() : "";
    const plaintext = typeof body.plaintext === "string" ? body.plaintext : "";
    const companyId = typeof body.companyId === "string" && body.companyId.trim()
      ? body.companyId.trim()
      : null;
    const noteKind = typeof body.noteKind === "string" ? body.noteKind : undefined;

    if (!objectId) {
      return NextResponse.json({ error: "objectId is required" }, { status: 400 });
    }
    if (!plaintext.trim()) {
      return NextResponse.json({ error: "plaintext is required" }, { status: 400 });
    }

    const scopedObject = getScopedNoteObject(objectId);
    if ("error" in scopedObject) {
      return NextResponse.json(
        { error: scopedObject.error },
        { status: scopedObject.error === "Object not found" ? 404 : 400 },
      );
    }
    if (companyId && !scopedObject.companyIds.includes(companyId)) {
      return NextResponse.json(
        { error: "companyId does not match objectId" },
        { status: 400 },
      );
    }

    const note = await upsertFounderAdminNote({
      objectId,
      companyId,
      noteKind,
      plaintext,
      sourceRefs: normalizeSourceRefs(body.sourceRefs),
      userId: admin.userId,
      auditCompanyId: admin.rootCompanyId,
    });

    return NextResponse.json({ note });
  } catch (err) {
    if (err instanceof Error && err.message === "Invalid noteKind") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleApiError(err);
  }
}
