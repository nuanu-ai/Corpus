import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  requireRoutineDomainAccess,
  requireRoutinePolicyAdmin,
} from "@/lib/routines/api-access";
import { buildRoutineSourceConfigPatch } from "@/lib/routines/source-config";
import {
  getCompanyRoutine,
  getRoutineSource,
  recordRoutineAuditLog,
  updateRoutineSourceConfig,
} from "@/lib/routines/store";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function PATCH(
  req: NextRequest,
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

    const patch = buildRoutineSourceConfigPatch({
      existing: source,
      patch: objectBody(await req.json().catch(() => ({}))),
      changedByUserId: auth.userId,
    });
    if (patch.error || !patch.value) {
      return NextResponse.json({ error: patch.error ?? "Invalid source config" }, { status: 400 });
    }

    const updated = await updateRoutineSourceConfig({
      companyId: auth.companyId,
      routineId,
      sourceId,
      fields: patch.value.fields,
      metadata: patch.value.metadata,
      resetObservationState: patch.value.resetObservationState,
    });
    if (!updated) return NextResponse.json({ error: "Routine source not found" }, { status: 404 });
    await recordRoutineAuditLog({
      companyId: auth.companyId,
      userId: auth.userId,
      action: "routine_source_updated",
      entityType: "routine_source",
      entityId: sourceId,
      oldValue: {
        sourceKey: source.sourceKey,
        title: source.title,
        url: source.url,
        status: source.status,
        sourceType: source.sourceType,
        fetchMode: source.fetchMode,
      },
      newValue: {
        sourceKey: updated.sourceKey,
        title: updated.title,
        url: updated.url,
        status: updated.status,
        sourceType: updated.sourceType,
        fetchMode: updated.fetchMode,
      },
      details: {
        routineId,
        resetObservationState: patch.value.resetObservationState === true,
      },
    });
    return NextResponse.json({ source: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
