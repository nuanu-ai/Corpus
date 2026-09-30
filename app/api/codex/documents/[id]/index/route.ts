import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { parseCodexPersistedBundle } from "@/lib/codex-worker/bundle";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { readQmdFile } from "@/lib/company-db/client";
import { toQmd } from "@/lib/company-db/summary/qmd";
import { getCodexPreprocessState } from "@/lib/codex-worker/status";
import { db } from "@/lib/db";
import { companies, documents } from "@/lib/db/schema";
import { storage } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.read");
    const { companyId } = auth;
    const { id } = await params;

    const [doc] = await db
      .select({
        ocrResult: documents.ocrResult,
        companyDbPort: companies.companyDbPort,
      })
      .from(documents)
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const codex = getCodexPreprocessState(doc.ocrResult ?? undefined);
    if (!codex?.index_file_path) {
      return NextResponse.json(
        { error: "Codex bundle is not available for this document" },
        { status: 409 },
      );
    }

    const companySlug = await getCompanySlug(companyId);
    const raw = await readQmdFile(codex.index_file_path, {
      companySlug,
      callerId: `codex-dashboard-${companySlug}`,
      callerRole: "owner",
      port: doc.companyDbPort,
    });

    if (raw === null && codex.bundle_storage_key) {
      try {
        const persistedRaw = await storage.get(codex.bundle_storage_key);
        const bundle = parseCodexPersistedBundle(persistedRaw, id);
        const indexFile = bundle.files.find((file) => file.path === codex.index_file_path);
        if (indexFile) {
          return new NextResponse(toQmd(indexFile.frontmatter, indexFile.body), {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "private, no-store",
            },
          });
        }
      } catch {
        // Fall through to not-found response.
      }
    }

    if (raw === null) {
      return NextResponse.json({ error: "Codex index file not found in Company-DB" }, { status: 404 });
    }

    return new NextResponse(raw, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
