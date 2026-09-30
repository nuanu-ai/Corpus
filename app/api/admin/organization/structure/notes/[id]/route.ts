import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import { requireOrganizationStructureAdmin } from "@/lib/operating-structure/admin-auth";
import { deleteFounderAdminNote } from "@/lib/operating-structure/founder-notes";
import { buildOrganizationOperatingStructureModel } from "@/lib/operating-structure/serializer";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireOrganizationStructureAdmin();
    const { id } = await context.params;
    const model = buildOrganizationOperatingStructureModel();
    const companyIds = model.objects
      .map((object) => object.appCompanyId)
      .filter((companyId): companyId is string => Boolean(companyId));
    const deleted = await deleteFounderAdminNote({
      id,
      objectIds: model.objects.map((object) => object.id),
      companyIds,
      userId: admin.userId,
      auditCompanyId: admin.rootCompanyId,
    });
    if (!deleted) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
