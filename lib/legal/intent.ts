/**
 * Legal contract-comparison intent detection.
 *
 * Pure helper used by the chat router to decide whether a user turn should be
 * routed to the durable legal comparison workflow (handoff CORPUS-42) instead of
 * being answered inline from raw attachment parts.
 *
 * Detection rule: the latest user turn has 2+ legal-document attachments AND
 * mentions a comparison / template-alignment phrase. Bilingual (EN/RU) phrase
 * lists to support multilingual legal teams.
 */

export interface LegalAttachmentRef {
  name: string;
  mediaType?: string;
}

export type LegalComparisonIntentKind = "compare" | "align_to_template";

export interface LegalComparisonIntent {
  /** True when the turn should route to the legal comparison workflow. */
  detected: boolean;
  intent: LegalComparisonIntentKind | null;
  attachmentCount: number;
  legalAttachmentCount: number;
  matchedPhrase: string | null;
  reason: string;
}

// Phrases that signal template-alignment (take precedence over compare).
// Multilingual EN/RU + Indonesian phrase lists.
const ALIGN_PHRASES = [
  "align to template", "make similar", "make it similar", "match the template",
  "template alignment", "revised agreement", "rewrite to match",
  "выровнять по шаблону", "сделай похожим на шаблон", "под шаблон",
  "перепиши по образцу",
  "sesuaikan", "samakan dengan template", "ikuti template", "samakan dengan",
] as const;

// Phrases that signal comparison / diff. Action words only — bare nouns like
// "model contract"/"clause" were removed (false positives in non-compare turns).
const COMPARE_PHRASES = [
  "compare", "comparison", "differences", "diff between", "what changed",
  "missing clauses",
  "сравни", "сравнение", "различия", "отличия", "чем отличаются", "сравнить договоры",
  "bandingkan", "perbedaan", "selisih", "bedanya", "apa bedanya",
] as const;

const LEGAL_EXTENSIONS = [".pdf", ".doc", ".docx"] as const;
const LEGAL_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const LEGAL_NAME_HINTS = [
  "agreement", "contract", "nda", "moa", "memorandum", "addendum", "legal",
  "договор", "контракт", "соглашение", "дополнение",
] as const;

function lower(s: string | undefined | null): string {
  return (s ?? "").toLowerCase();
}

/** A legal-document attachment: PDF/DOC/DOCX by media type or extension, or a
 * filename that looks like a legal artifact (agreement/contract/NDA/...). */
export function isLegalDoc(attachment: LegalAttachmentRef): boolean {
  const name = lower(attachment.name);
  const media = lower(attachment.mediaType);
  if (LEGAL_MEDIA_TYPES.has(media)) return true;
  if (LEGAL_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return LEGAL_NAME_HINTS.some((hint) => name.includes(hint));
}

function findPhrase(text: string, phrases: readonly string[]): string | null {
  for (const p of phrases) {
    if (text.includes(p)) return p;
  }
  return null;
}

/**
 * Detect legal contract comparison / template-alignment intent.
 *
 * @example
 *   detectLegalComparisonIntent({
 *     attachments: [{ name: "model.pdf" }, { name: "target.pdf" }],
 *     messageText: "compare these two agreements",
 *   }) // => { detected: true, intent: "compare", ... }
 */
export function detectLegalComparisonIntent(input: {
  attachments: LegalAttachmentRef[];
  messageText: string;
}): LegalComparisonIntent {
  const text = lower(input.messageText);
  const attachments = input.attachments ?? [];
  const legalCount = attachments.filter(isLegalDoc).length;

  const alignPhrase = findPhrase(text, ALIGN_PHRASES);
  const comparePhrase = findPhrase(text, COMPARE_PHRASES);
  const phrase = alignPhrase ?? comparePhrase;
  const intent: LegalComparisonIntentKind | null = alignPhrase
    ? "align_to_template"
    : comparePhrase
      ? "compare"
      : null;

  const detected = legalCount >= 2 && phrase !== null;
  const reason = detected
    ? `2+ legal docs and phrase '${phrase}'`
    : legalCount < 2
      ? `need >=2 legal docs, found ${legalCount}`
      : "legal docs present but no compare/align phrase";

  return {
    detected,
    intent,
    attachmentCount: attachments.length,
    legalAttachmentCount: legalCount,
    matchedPhrase: phrase,
    reason,
  };
}
