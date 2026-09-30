"use client";

// Sandbox attachment adapter — composed from built-in assistant-ui pieces
// plus one small custom layer for PDF / XLSX / DOCX.
//
// What lives where:
//   1. SimpleImageAttachmentAdapter  (built-in)  → image/*  → vision part.
//   2. SimpleTextAttachmentAdapter   (built-in)  → text/*   → inlined as
//      <attachment name=...>…</attachment> text part.
//   3. PdfAndSpreadsheetSandboxAdapter (this file) →
//        - PDFs: read as data URL and emit a `file` UI part Anthropic
//          treats as a native PDF document.
//        - XLSX / DOCX / CSV (big or binary): POST to
//          /api/chat/inspect-attachment for a markdown preview, return
//          the preview as a text part. The endpoint is *ephemeral* - it
//          does not write to documents/raw_events/storage.
//
// Nothing here writes to the database. Persistence to Company-DB is a
// future explicit user action through a `save_attached_file` tool.

import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
} from "@assistant-ui/react";

export interface CreateAttachmentAdapterOptions {
  /** Endpoint that produces a markdown preview for binary office files. */
  inspectUrl?: string;
  /** Notify on irrecoverable read/inspect failures (e.g. wire to a toast). */
  onError?: (error: Error, context: { fileName: string }) => void;
}

const MAX_PDF_BYTES = 25 * 1024 * 1024;          // Anthropic PDF cap
const MAX_INSPECT_BYTES = 10 * 1024 * 1024;       // matches inspector route

const PDF_MIMES = new Set(["application/pdf"]);

const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const SPREADSHEET_EXT_RE = /\.(xlsx|xls|ods|docx)$/i;

async function readFileAsDataUrl(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return `data:${file.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`;
}

function isSpreadsheetOrDoc(file: File): boolean {
  return SPREADSHEET_MIMES.has(file.type) || SPREADSHEET_EXT_RE.test(file.name);
}

/**
 * Custom adapter for PDF + spreadsheet/docx. Implements the same shape as
 * SimpleImage/SimpleText so it slots into CompositeAttachmentAdapter.
 */
class PdfAndSpreadsheetSandboxAdapter implements AttachmentAdapter {
  accept =
    "application/pdf," +
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
    "application/vnd.ms-excel," +
    "application/vnd.oasis.opendocument.spreadsheet," +
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
    ".xlsx,.xls,.ods,.docx";

  // Stash per-pending-attachment payloads keyed by file identity.
  // (Composite passes the same File reference through add → send → remove.)
  private payloads = new WeakMap<
    File,
    | { kind: "pdf"; dataUrl: string; mediaType: string }
    | { kind: "preview"; text: string }
    | { kind: "error"; message: string }
  >();

  constructor(private readonly options: CreateAttachmentAdapterOptions) {}

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    // Infer application/pdf when the browser omits MIME (some browsers send an
    // empty / application/octet-stream type for .pdf files — without this the
    // PDF is rejected as "unsupported mime", matching a previously observed failure).
    const effectiveType =
      file.type && file.type !== "application/octet-stream"
        ? file.type
        : /\.pdf$/i.test(file.name)
          ? "application/pdf"
          : file.type || "application/octet-stream";
    const base = {
      id: file.name,
      type: "document" as const,
      name: file.name,
      contentType: effectiveType,
      file,
    };

    const fail = (message: string): PendingAttachment => {
      this.payloads.set(file, { kind: "error", message });
      try {
        this.options.onError?.(new Error(message), { fileName: file.name });
      } catch {
        // never let onError abort the upload
      }
      return { ...base, status: { type: "incomplete", reason: "error" } };
    };

    if (file.size === 0) {
      return fail(
        `File "${file.name}" is empty. Please re-export or re-download it and try again.`,
      );
    }

    if (PDF_MIMES.has(effectiveType)) {
      if (file.size > MAX_PDF_BYTES) {
        return fail(
          `PDF "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
        );
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        this.payloads.set(file, {
          kind: "pdf",
          dataUrl,
          mediaType: file.type,
        });
        return {
          ...base,
          status: { type: "requires-action", reason: "composer-send" },
        };
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : `Failed to read "${file.name}".`,
        );
      }
    }

    if (isSpreadsheetOrDoc(file)) {
      if (file.size > MAX_INSPECT_BYTES) {
        return fail(
          `File "${file.name}" exceeds ${MAX_INSPECT_BYTES / 1024 / 1024} MB inspect limit.`,
        );
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", file.name);
      let response: Response;
      try {
        response = await fetch(
          this.options.inspectUrl ?? "/api/chat/inspect-attachment",
          { method: "POST", credentials: "include", body: formData },
        );
      } catch (networkError) {
        return fail(
          networkError instanceof Error
            ? `Could not analyze "${file.name}" (${networkError.message}).`
            : `Could not analyze "${file.name}" — network error.`,
        );
      }
      if (!response.ok) {
        let message = `Inspect failed (${response.status}) for "${file.name}".`;
        try {
          const body = (await response.json()) as { error?: unknown };
          if (typeof body?.error === "string" && body.error) message = body.error;
        } catch {
          // leave default
        }
        return fail(message);
      }
      const body = (await response.json().catch(() => null)) as
        | { preview?: unknown }
        | null;
      const preview =
        typeof body?.preview === "string" ? body.preview : null;
      if (!preview) {
        return fail(`Inspector returned no preview for "${file.name}".`);
      }
      this.payloads.set(file, { kind: "preview", text: preview });
      return {
        ...base,
        status: { type: "requires-action", reason: "composer-send" },
      };
    }

    return fail(
      `Mime "${file.type || "unknown"}" not supported by the sandbox adapter.`,
    );
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const payload = this.payloads.get(attachment.file);
    this.payloads.delete(attachment.file);

    if (payload?.kind === "pdf") {
      // PDF as a real file UI part — Anthropic accepts it as a document
      // content block. The cast below works around the SDK build's typing
      // of CompleteAttachment.content as text-only; the runtime accepts
      // FileUIPart entries in the same array.
      const fileTag = {
        type: "file",
        mediaType: payload.mediaType,
        filename: attachment.name,
        url: payload.dataUrl,
      } as unknown as { type: "text"; text: string };
      return {
        ...attachment,
        status: { type: "complete" },
        content: [
          fileTag,
          { type: "text", text: `[Attached: ${attachment.name}]` },
        ],
      };
    }

    if (payload?.kind === "preview") {
      return {
        ...attachment,
        status: { type: "complete" },
        content: [
          {
            type: "text",
            text: `<attachment name="${attachment.name}">\n${payload.text}\n</attachment>`,
          },
        ],
      };
    }

    // Fallback / error — let the user know without crashing the send.
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "text",
          text: `[Attachment "${attachment.name}" could not be prepared${payload?.kind === "error" ? `: ${payload.message}` : ""}.]`,
        },
      ],
    };
  }

  async remove(attachment: { file?: File }): Promise<void> {
    if (attachment.file) this.payloads.delete(attachment.file);
  }
}

/**
 * Build the chat composer's attachment adapter. Order in the composite
 * matters - earlier adapters claim files matching their `accept` first:
 *   1. images  -> SimpleImageAttachmentAdapter
 *   2. text    -> SimpleTextAttachmentAdapter
 *   3. pdf/xlsx/docx → PdfAndSpreadsheetSandboxAdapter (this file)
 */
export function createAttachmentAdapter(
  options: CreateAttachmentAdapterOptions = {},
): AttachmentAdapter {
  return new CompositeAttachmentAdapter([
    new SimpleImageAttachmentAdapter(),
    new SimpleTextAttachmentAdapter(),
    new PdfAndSpreadsheetSandboxAdapter(options),
  ]);
}
