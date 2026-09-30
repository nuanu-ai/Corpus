import { extractKnowledgeText } from "@/lib/document-parsers/knowledge-extractor";
import { extractUnstructuredText } from "@/lib/document-parsers/unstructured-text";

export interface NarrativeExtractResult {
  title: string;
  rawText: string;
  markdown: string;
  wordCount: number;
  metadata?: Record<string, unknown>;
}

function fileNameToTitle(fileName: string): string {
  const dotIdx = fileName.lastIndexOf(".");
  return dotIdx === -1 ? fileName : fileName.slice(0, dotIdx);
}

function normalizeNarrativeMarkdown(title: string, rawText: string): string {
  const body = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return `# ${title}\n\n${body}\n`;
}

export async function extractNarrativeContent(
  buffer: Buffer,
  input: {
    fileName: string;
    fileType: string;
  },
): Promise<NarrativeExtractResult> {
  if (input.fileType === "knowledge") {
    const extracted = await extractKnowledgeText(buffer, input.fileName, input.fileType);
    return {
      title: extracted.title,
      rawText: extracted.text,
      markdown: normalizeNarrativeMarkdown(extracted.title, extracted.text),
      wordCount: extracted.wordCount,
      metadata: extracted.metadata,
    };
  }

  if (input.fileType === "pdf") {
    const extracted = await extractUnstructuredText(buffer, {
      fileType: "pdf",
      fileName: input.fileName,
    });
    const title = fileNameToTitle(input.fileName);
    return {
      title,
      rawText: extracted.text.trim(),
      markdown: normalizeNarrativeMarkdown(title, extracted.text),
      wordCount: extracted.text.trim() ? extracted.text.trim().split(/\s+/).length : 0,
      metadata: {
        provider: "unstructured-text",
        backend: extracted.backend,
        ...(extracted.metadata ?? {}),
      },
    };
  }

  throw new Error(`Unsupported narrative file type: "${input.fileType}"`);
}
