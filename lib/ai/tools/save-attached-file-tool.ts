/**
 * `save_attached_file` — explicit, opt-in persistence for files the user
 * dropped into the chat composer. Sandbox attachments are ephemeral by
 * default (see `app/assistant/_lib/attachment-adapter.ts`); when the user
 * actually wants to keep one ("save this PDF to documents"), the agent calls
 * this tool with the file's original name.
 *
 * Only files whose original bytes survived the trip to the model are
 * persistable here — that means `file` UI parts (PDFs, images) where the
 * data URL is still in the message. Office files (xlsx/docx) are dropped
 * after the inspect-attachment preview, so they cannot be saved post-hoc;
 * the tool returns a clear error in that case so the agent can ask the user
 * to upload the original through the upload UI instead.
 */

import { tool } from "ai";
import { z } from "zod";

import {
  saveDocumentFromChat,
  SaveDocumentValidationError,
} from "@/lib/documents/save-from-chat";

export interface SaveAttachedFilePayload {
  buffer: Buffer;
  mediaType: string;
}

export interface SaveAttachedFileToolContext {
  companyId: string;
  userId: string;
  /** Lookup keyed by the original file name as it appears in the chat. */
  attachmentsByName: Map<string, SaveAttachedFilePayload>;
}

export const SAVE_ATTACHED_FILE_TOOL_NAME = "save_attached_file" as const;

const inputSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe(
      "The original file name of the attachment as the user sees it in the chat (e.g. \"Invoice 2026-04.pdf\"). Match it exactly, including extension.",
    ),
  agentNotes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe(
      "Short note for audit recording why the user is saving the file (e.g. \"User: 'save this invoice for the audit folder'\").",
    ),
});

export function createSaveAttachedFileTool(ctx: SaveAttachedFileToolContext) {
  return tool({
    description: [
      "Save a file the user attached in this chat to the company's documents store.",
      "ONLY call this when the user explicitly asks to save / keep / remember the file — sandbox attachments are intentionally ephemeral.",
      "Pass the file name exactly as the user uploaded it. Office files (xlsx/docx) attached as previews CANNOT be saved through this tool — ask the user to upload them via the upload button instead.",
    ].join(" "),
    inputSchema,
    execute: async (input) => {
      const payload = ctx.attachmentsByName.get(input.fileName);
      if (!payload) {
        return {
          ok: false as const,
          reason: "not_found" as const,
          message: `No attachment named "${input.fileName}" is available in the current message. Confirm the exact file name with the user, or ask them to re-attach.`,
          availableFileNames: Array.from(ctx.attachmentsByName.keys()),
        };
      }

      try {
        const result = await saveDocumentFromChat({
          companyId: ctx.companyId,
          userId: ctx.userId,
          fileName: input.fileName,
          mediaType: payload.mediaType,
          buffer: payload.buffer,
          agentNotes: input.agentNotes ?? null,
        });
        return {
          ok: true as const,
          documentId: result.documentId,
          fileName: result.fileName,
          fileType: result.fileType,
          fileSizeBytes: result.fileSizeBytes,
          status: result.status,
        };
      } catch (err) {
        if (err instanceof SaveDocumentValidationError) {
          return {
            ok: false as const,
            reason: "rejected" as const,
            message: err.message,
          };
        }
        throw err;
      }
    },
  });
}
