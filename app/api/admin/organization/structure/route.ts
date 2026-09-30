import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { handleApiError } from "@/lib/api-auth";
import { requireOrganizationStructureAdmin } from "@/lib/operating-structure/admin-auth";
import { listFounderAdminNoteMetadata } from "@/lib/operating-structure/founder-notes";
import { operatingStructureManifestSchema } from "@/lib/operating-structure/manifest";
import { publishOperatingStructure } from "@/lib/operating-structure/publisher";
import { buildOrganizationOperatingStructureModel } from "@/lib/operating-structure/serializer";

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

export async function GET() {
  try {
    const admin = await requireOrganizationStructureAdmin();
    const model = buildOrganizationOperatingStructureModel();
    const companyIds = model.objects
      .map((object) => object.appCompanyId)
      .filter((companyId): companyId is string => Boolean(companyId));
    const noteMetadata = await listFounderAdminNoteMetadata({
      objectIds: model.objects.map((object) => object.id),
      companyIds,
    });
    const validationIssues = await publishOperatingStructure({
      companyId: admin.rootCompanyId,
      companySlug: admin.rootCompanySlug,
      companyDbPort: admin.rootCompanyDbPort,
      actorUserId: admin.userId,
      dryRun: true,
      model,
    });

    return NextResponse.json({
      admin: {
        role: admin.role,
        rootCompanyId: admin.rootCompanyId,
        rootCompanySlug: admin.rootCompanySlug,
      },
      model,
      noteMetadata,
      publishPreview: safePublishResult(validationIssues),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireOrganizationStructureAdmin();
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const dryRun = body.dryRun !== false;
    if (body.model !== undefined) {
      return NextResponse.json(
        {
          error:
            "Raw operating structure model payloads are not accepted; submit a manifest change set instead",
        },
        { status: 400 },
      );
    }

    const manifest = operatingStructureManifestSchema.parse(body.manifest ?? {});
    if (!dryRun && !manifest.parentCompanyMutationApproved && manifest.companyMutations.length > 0) {
      return NextResponse.json(
        {
          error:
            "Company cleanup mutations require parentCompanyMutationApproved=true before publish",
        },
        { status: 400 },
      );
    }
    const model = buildOrganizationOperatingStructureModel({ manifest });

    const result = await publishOperatingStructure({
      companyId: admin.rootCompanyId,
      companySlug: admin.rootCompanySlug,
      companyDbPort: admin.rootCompanyDbPort,
      actorUserId: admin.userId,
      dryRun,
      model,
      parentCompanyMutationAllowed: manifest.parentCompanyMutationApproved,
    });

    return NextResponse.json({ result: safePublishResult(result) });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid operating structure manifest",
          issues: err.issues,
        },
        { status: 400 },
      );
    }
    return handleApiError(err);
  }
}
