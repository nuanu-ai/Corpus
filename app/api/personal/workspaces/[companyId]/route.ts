import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import {
  loadPersonalLinkedWorkspaces,
  savePersonalWorkspaceLink,
} from "@/lib/company-db/personal-surfaces";

const workspaceUpdateSchema = z.object({
  noteBody: z.string().optional(),
  waitingFors: z.array(z.string()).optional(),
  refreshMirror: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const { companyId } = await params;
    const workspaces = await loadPersonalLinkedWorkspaces({
      tenantId: auth.projectId,
      userId: auth.userId,
      role: auth.role,
    });

    const workspace = workspaces.find((item) => item.companyId === companyId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json(workspace, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const { companyId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = workspaceUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid workspace payload" }, { status: 400 });
    }

    const result = await savePersonalWorkspaceLink({
      context: {
        tenantId: auth.projectId,
        userId: auth.userId,
        role: auth.role,
      },
      companyId,
      noteBody: parsed.data.noteBody,
      waitingFors: parsed.data.waitingFors,
      refreshMirror: parsed.data.refreshMirror,
    });

    return NextResponse.json(
      {
        ok: true,
        notePath: result.notePath,
        mirrorRefreshedAt: result.mirrorRefreshedAt,
        mirrorUpdated: result.mirrorUpdated,
        mirrorWarning: result.mirrorWarning,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
