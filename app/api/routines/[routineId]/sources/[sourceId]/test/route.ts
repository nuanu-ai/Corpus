import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  requireRoutineDomainAccess,
  requireRoutinePolicyAdmin,
} from "@/lib/routines/api-access";
import { fetchLegalWatchSourceWithProvider } from "@/lib/routines/legal-watch/providers";
import { routineSourceToDefinition, validateRoutineSourceConfig } from "@/lib/routines/source-config";
import {
  getCompanyRoutine,
  getRoutineSource,
  recordRoutineAuditLog,
} from "@/lib/routines/store";

async function auditSourceTest(input: {
  companyId: string;
  userId: string | null;
  routineId: string;
  sourceId: string;
  ok: boolean;
  provider?: string | null;
  error?: string | null;
}) {
  try {
    await recordRoutineAuditLog({
      companyId: input.companyId,
      userId: input.userId,
      action: "routine_source_tested",
      entityType: "routine_source",
      entityId: input.sourceId,
      newValue: {
        ok: input.ok,
        provider: input.provider ?? null,
      },
      details: {
        routineId: input.routineId,
        error: input.error ?? null,
      },
    });
  } catch (error) {
    console.warn("[routines] failed to audit source test", error);
  }
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ routineId: string; sourceId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, sourceId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");
    requireRoutinePolicyAdmin(auth);

    const source = await getRoutineSource({
      companyId: auth.companyId,
      routineId,
      sourceId,
    });
    if (!source) return NextResponse.json({ error: "Routine source not found" }, { status: 404 });

    const validation = validateRoutineSourceConfig(source);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    try {
      const result = await fetchLegalWatchSourceWithProvider(routineSourceToDefinition(source));
      const provider = typeof result.rawSnapshot.provider === "string"
        ? result.rawSnapshot.provider
        : "native";
      await auditSourceTest({
        companyId: auth.companyId,
        userId: auth.userId,
        routineId,
        sourceId,
        ok: true,
        provider,
      });
      return NextResponse.json({
        ok: true,
        result: {
          sourceKey: result.sourceKey,
          canonicalUrl: result.canonicalUrl,
          title: result.title,
          contentType: result.contentType,
          contentHash: result.contentHash,
          sourceDate: result.sourceDate,
          fetchedAt: result.fetchedAt,
          bodyTextLength: result.bodyText.length,
          provider,
          apifyRunId: typeof result.rawSnapshot.runId === "string"
            ? result.rawSnapshot.runId
            : undefined,
          apifyDatasetId: typeof result.rawSnapshot.datasetId === "string"
            ? result.rawSnapshot.datasetId
            : undefined,
          itemCount: typeof result.rawSnapshot.itemCount === "number"
            ? result.rawSnapshot.itemCount
            : undefined,
          itemUrls: Array.isArray(result.rawSnapshot.itemUrls)
            ? result.rawSnapshot.itemUrls.filter((item): item is string => typeof item === "string")
            : undefined,
          rawSnapshot: result.rawSnapshot,
        },
      });
    } catch (error) {
      await auditSourceTest({
        companyId: auth.companyId,
        userId: auth.userId,
        routineId,
        sourceId,
        ok: false,
        error: error instanceof Error ? error.message : "Fetch failed",
      });
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : "Fetch failed",
      });
    }
  } catch (error) {
    return handleApiError(error);
  }
}
