import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  requireRoutineDomainAccess,
  requireRoutinePolicyAdmin,
} from "@/lib/routines/api-access";
import { buildCustomRoutineSourceConfig } from "@/lib/routines/source-config";
import {
  createRoutineSourceConfig,
  getCompanyRoutine,
  listRoutineSources,
  recordRoutineAuditLog,
} from "@/lib/routines/store";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "read");

    const sources = await listRoutineSources(auth.companyId, routineId);
    return NextResponse.json({ sources });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");
    requireRoutinePolicyAdmin(auth);

    const body = objectBody(await req.json().catch(() => ({})));
    const config = buildCustomRoutineSourceConfig({
      body,
      changedByUserId: auth.userId,
    });
    if (config.error || !config.value) {
      return NextResponse.json({ error: config.error ?? "Invalid source config" }, { status: 400 });
    }

    const source = await createRoutineSourceConfig({
      companyId: auth.companyId,
      routineId,
      source: config.value,
    });
    await recordRoutineAuditLog({
      companyId: auth.companyId,
      userId: auth.userId,
      action: "routine_source_created",
      entityType: "routine_source",
      entityId: source.id,
      newValue: {
        sourceKey: source.sourceKey,
        title: source.title,
        url: source.url,
        status: source.status,
        sourceType: source.sourceType,
        fetchMode: source.fetchMode,
      },
      details: { routineId },
    });
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
