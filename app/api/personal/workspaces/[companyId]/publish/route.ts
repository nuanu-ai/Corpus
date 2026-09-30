import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { publishPersonalWorkspaceLink } from "@/lib/company-db/personal-surfaces";

const publishWorkspaceSchema = z.object({
  title: z.string().optional(),
  noteBody: z.string().optional(),
  waitingFors: z.array(z.string()).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const { companyId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = publishWorkspaceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid publish payload" }, { status: 400 });
    }

    const result = await publishPersonalWorkspaceLink({
      context: {
        tenantId: auth.projectId,
        userId: auth.userId,
        role: auth.role,
      },
      companyId,
      title: parsed.data.title,
      noteBody: parsed.data.noteBody,
      waitingFors: parsed.data.waitingFors,
    });

    return NextResponse.json(
      {
        ok: true,
        filePath: result.filePath,
        companyId: result.companyId,
        companySlug: result.companySlug,
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
