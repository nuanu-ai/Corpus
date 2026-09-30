import { redirect } from "next/navigation";

import { handleApiError } from "@/lib/api-auth";
import { requireOrganizationStructureAdmin } from "@/lib/operating-structure/admin-auth";
import { listFounderAdminNoteMetadata } from "@/lib/operating-structure/founder-notes";
import { publishOperatingStructure } from "@/lib/operating-structure/publisher";
import { buildOrganizationOperatingStructureModel } from "@/lib/operating-structure/serializer";

import { StructureWorkbench } from "./_components/structure-workbench";

export const dynamic = "force-dynamic";

function safePublishResult(result: Awaited<ReturnType<typeof publishOperatingStructure>>) {
  return {
    dryRun: result.dryRun,
    commitSha: result.commitSha,
    validationIssues: result.validationIssues,
    fileCount: result.fileCount,
    files: result.files.map((file) => ({ path: file.path })),
    accessEdgeMutations: result.accessEdgeMutations,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function loadOrganizationStructurePageData() {
  try {
    const admin = await requireOrganizationStructureAdmin();
    const model = buildOrganizationOperatingStructureModel();
    const companyIds = model.objects
      .map((object) => object.appCompanyId)
      .filter((companyId): companyId is string => Boolean(companyId));
    const [noteMetadata, publishPreview] = await Promise.all([
      listFounderAdminNoteMetadata({
        objectIds: model.objects.map((object) => object.id),
        companyIds,
      }),
      publishOperatingStructure({
        companyId: admin.rootCompanyId,
        companySlug: admin.rootCompanySlug,
        companyDbPort: admin.rootCompanyDbPort,
        actorUserId: admin.userId,
        dryRun: true,
        model,
      }),
    ]);

    return {
      ok: true as const,
      admin,
      model,
      noteMetadata,
      publishPreview,
    };
  } catch (err) {
    const response = handleApiError(err);
    return {
      ok: false as const,
      status: response.status,
    };
  }
}

export default async function OrganizationStructurePage() {
  const data = await loadOrganizationStructurePageData();
  if (!data.ok) {
    if (data.status === 401) redirect("/login");
    redirect("/dashboard");
  }

  return (
    <StructureWorkbench
      admin={{
        role: data.admin.role,
        rootCompanyId: data.admin.rootCompanyId,
        rootCompanySlug: data.admin.rootCompanySlug,
      }}
      initialSnapshot={{
        model: data.model,
        noteMetadata: data.noteMetadata.map((note) => ({
          id: note.id,
          objectId: note.objectId,
          companyId: note.companyId,
          noteKind: note.noteKind,
          keyVersion: note.keyVersion,
          updatedAt: iso(note.updatedAt),
        })),
        publishPreview: safePublishResult(data.publishPreview),
      }}
    />
  );
}
