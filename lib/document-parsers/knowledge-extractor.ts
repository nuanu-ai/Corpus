export interface KnowledgeResult {
  text: string;
  title: string;
  wordCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Extract normalized text from knowledge documents (txt, md, qmd, html, docx).
 * Does NOT return transactions — this is for search/context only.
 */
export async function extractKnowledgeText(
  buffer: Buffer,
  fileName: string,
  _fileType: string,
): Promise<KnowledgeResult> {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();

  if (ext === ".docx") {
    return extractDocx(buffer, fileName);
  }

  const raw = buffer.toString("utf-8");

  if (ext === ".md" || ext === ".qmd") {
    return extractMarkdown(raw, fileName);
  }

  if (ext === ".html" || ext === ".htm") {
    return extractHtml(raw, fileName);
  }

  const title = fileNameToTitle(fileName);
  return {
    text: raw,
    title,
    wordCount: countWords(raw),
  };
}

function extractMarkdown(raw: string, fileName: string): KnowledgeResult {
  let text = raw;
  let title: string | null = null;

  // Strip YAML frontmatter and extract title
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fmMatch) {
    const fmBlock = fmMatch[1];
    text = fmMatch[2];

    const titleMatch = fmBlock.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  // Fallback: first H1
  if (!title) {
    const h1Match = text.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    }
  }

  return {
    text: text.trim(),
    title: title ?? fileNameToTitle(fileName),
    wordCount: countWords(text),
  };
}

function extractHtml(raw: string, fileName: string): KnowledgeResult {
  const normalized = raw.replace(/\r\n/g, "\n");
  const title =
    extractHtmlTagText(normalized, "title") ??
    extractHtmlTagText(normalized, "h1") ??
    fileNameToTitle(fileName);

  const text = htmlToMarkdownishText(normalized);

  return {
    text,
    title,
    wordCount: countWords(text),
    metadata: {
      source_format: "html",
    },
  };
}

async function extractDocx(
  buffer: Buffer,
  fileName: string,
): Promise<KnowledgeResult> {
  // Use mammoth for docx → plain text extraction.
  // Lazy import so the dependency is only loaded when needed.
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  return {
    text,
    title: fileNameToTitle(fileName),
    wordCount: countWords(text),
  };
}

function fileNameToTitle(fileName: string): string {
  const dotIdx = fileName.lastIndexOf(".");
  const base = dotIdx === -1 ? fileName : fileName.slice(0, dotIdx);
  return base;
}

function extractHtmlTagText(raw: string, tag: string): string | null {
  const match = raw.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  const text = match?.[1] ? htmlToMarkdownishText(match[1]) : "";
  return text.trim().length > 0 ? text.trim() : null;
}

function htmlToMarkdownishText(raw: string): string {
  const withoutComments = raw.replace(/<!--[\s\S]*?-->/g, " ");
  const withoutIgnoredBlocks = withoutComments
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const withHeadings = withoutIgnoredBlocks
    .replace(/<h1\b[^>]*>/gi, "\n# ")
    .replace(/<h2\b[^>]*>/gi, "\n## ")
    .replace(/<h3\b[^>]*>/gi, "\n### ")
    .replace(/<h4\b[^>]*>/gi, "\n#### ")
    .replace(/<h5\b[^>]*>/gi, "\n##### ")
    .replace(/<h6\b[^>]*>/gi, "\n###### ")
    .replace(/<\/h[1-6]>/gi, "\n");

  const withLists = withHeadings
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n");

  const withLineBreaks = withLists
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|main|aside|nav|blockquote|pre|ul|ol|table|tr)>/gi, "\n")
    .replace(/<(?:hr)\b[^>]*>/gi, "\n---\n");

  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(withoutTags)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decoded;
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    ndash: "-",
    mdash: "-",
    hellip: "...",
  };

  return value
    .replace(/&([a-z]+);/gi, (match, entity: string) => namedEntities[entity.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );
}

function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}
