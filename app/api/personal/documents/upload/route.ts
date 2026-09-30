import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { validateUploadedBuffer } from "@/lib/documents";
import { createCompanyDocumentFromBytes } from "@/lib/documents/operations";

export async function POST(req: NextRequest) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const content = Buffer.from(await file.arrayBuffer());
    const bufferValidation = validateUploadedBuffer(content);
    if (!bufferValidation.valid) {
      return NextResponse.json({ error: bufferValidation.error }, { status: 400 });
    }

    const result = await createCompanyDocumentFromBytes({
      companyId: auth.projectId,
      userId: auth.userId,
      fileName: file.name,
      mimeType: file.type,
      content,
      source: "personal_upload",
      ingressSource: "personal_upload",
      rawPayload: {
        route: "/api/personal/documents/upload",
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
