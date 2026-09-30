/**
 * POST /api/chat/inspect-attachment
 *
 * Ephemeral attachment inspector. Accepts a file from the chat composer and
 * returns a compact text/markdown preview the LLM can reason about — without
 * persisting anything to `documents` / `raw_events` / object storage.
 *
 * Use cases:
 *   - XLSX / CSV / DOCX / TXT / readable PDF / OCR-able image — extract
 *     structure or text so the model
 *     can answer questions about the file in-chat without ingesting it.
 *   - Unsupported binary files still return 415 so adapters can use another
 *     safe path or show a clear error.
 *
 * No persistence. No queue. The buffer leaves only as the inline preview
 * the model sees in the next user turn.
 */

import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  buildEphemeralAttachmentTextPreview,
  MAX_EPHEMERAL_ATTACHMENT_PREVIEW_BYTES,
} from "@/lib/chat/attachment-preview";
import { validateUploadedBuffer } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getPreviewKind(fileName: string, mime: string): "spreadsheet" | "text" | "preview" {
  if (
    /(\.xlsx|\.xls|\.ods|\.csv|\.tsv)$/i.test(fileName) ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.oasis.opendocument.spreadsheet"
  ) {
    return "spreadsheet";
  }
  if (
    /(\.md|\.txt|\.json|\.ya?ml|\.xml|\.html?|\.qmd|\.docx)$/i.test(fileName) ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "text";
  }
  return "preview";
}

export async function POST(req: NextRequest) {
  try {
    await getAuthContext();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing 'file' field with a blob" },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_EPHEMERAL_ATTACHMENT_PREVIEW_BYTES) {
      return NextResponse.json(
        {
          error: `File exceeds inspect limit (${Math.round(MAX_EPHEMERAL_ATTACHMENT_PREVIEW_BYTES / (1024 * 1024))} MB).`,
        },
        { status: 413 },
      );
    }

    const fileName =
      typeof form.get("fileName") === "string"
        ? String(form.get("fileName"))
        : (file as File).name || "attachment";
    const mime = file.type || "application/octet-stream";

    const buffer = Buffer.from(await file.arrayBuffer());
    const bufferValidation = validateUploadedBuffer(buffer);
    if (!bufferValidation.valid) {
      return NextResponse.json({ error: bufferValidation.error }, { status: 400 });
    }

    const preview = await buildEphemeralAttachmentTextPreview({
      buffer,
      fileName,
      mimeType: mime,
    });
    if (preview) {
      return NextResponse.json({ kind: getPreviewKind(fileName, mime), preview });
    }

    // Image / PDF / other binary — adapter should send those directly via
    // Anthropic file parts (data URL), not through this endpoint.
    return NextResponse.json(
      {
        error:
          "This mime type is not handled by inspect-attachment. Send it as a file part instead.",
        mime,
      },
      { status: 415 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
