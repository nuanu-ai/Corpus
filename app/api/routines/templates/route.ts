import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { canReadRoutine } from "@/lib/routines/api-access";
import { listRoutineTemplates } from "@/lib/routines/store";

export async function GET() {
  try {
    const auth = await getAuthContext();
    const templates = (await listRoutineTemplates()).filter((template) =>
      canReadRoutine(auth, template),
    );
    return NextResponse.json({ templates });
  } catch (error) {
    return handleApiError(error);
  }
}
