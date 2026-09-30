import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { inferDownloadMimeType } from "@/lib/documents";
import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { storage } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const { id } = await params;

    const [doc] = await db
      .select({
        storageUrl: documents.storageUrl,
        fileName: documents.fileName,
        fileType: documents.fileType,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.companyId, auth.projectId),
          ne(documents.status, "deleted"),
        ),
      );

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (typeof doc.storageUrl !== "string" || doc.storageUrl.trim().length === 0) {
      return NextResponse.json(
        { error: "Original source file is not available for this document" },
        { status: 409 },
      );
    }

    const buffer = await storage.get(doc.storageUrl);
    const requestUrl = req.nextUrl ? req.nextUrl : new URL(req.url);
    const disposition =
      requestUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

    const safeAscii = doc.fileName.replace(/[^\x20-\x7E]/g, "_");
    const encoded = encodeURIComponent(doc.fileName);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": inferDownloadMimeType(doc.fileName, doc.fileType),
        "Content-Disposition": `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
