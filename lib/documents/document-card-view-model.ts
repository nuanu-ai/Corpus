import { normalizeAppLocale, type AppLocale } from "@/lib/i18n/config";

export type DocumentCardStageKey =
  | "read"
  | "structured"
  | "needs_input"
  | "ready";

export type DocumentCardStageState = "done" | "active" | "pending" | "blocked";

export interface DocumentCardStage {
  key: DocumentCardStageKey;
  label: string;
  state: DocumentCardStageState;
}

export interface DocumentCardViewInput {
  id: string;
  fileName: string;
  status: string;
  reviewRequired?: boolean | null;
  clarificationPendingCount?: number | null;
  codex?: {
    stage?: string | null;
  } | null;
  promotion?: {
    stage?: string | null;
    promotedDomains?: string[] | null;
  } | null;
  audit?: {
    stage?: string | null;
    overallStatus?: "ok" | "warning" | "fail" | null;
  } | null;
}

export interface DocumentCardViewModel {
  headline: string;
  detail: string;
  tone: "processing" | "needs_input" | "review" | "ready" | "failed";
  stages: DocumentCardStage[];
  suggestedQuestions: string[];
}

const DOCUMENT_CARD_COPY = {
  en: {
    stages: {
      read: "Read",
      structured: "Structured",
      needs_input: "Questions",
      ready: "Ready",
    },
    failedHeadline: "Needs review",
    failedDetail:
      "Corpus could not process this file reliably. Open the source or run reprocess.",
    needsInputHeadline: "Document question pending",
    clarificationOne: "clarification",
    clarificationOther: "clarifications",
    needsInputDetail: (count: number, label: string) =>
      `Corpus needs ${count} ${label} to finish reliable parsing.`,
    reviewHeadline: "Saved. No action needed",
    reviewDetail:
      "The file is already stored. Confidence flags only tell Corpus to be cautious when using it.",
    qaPendingHeadline: "Processed, QA pending",
    qaPendingDetail:
      "The file is saved in company memory. QA is still checking the output.",
    readyHeadline: "Ready",
    readyDetail: "The file has been processed and is ready for Corpus questions.",
    suggestedQuestions: [
      "Show me the summary for this file",
      "Compare with the previous period",
      "What is unusual here?",
    ],
    structuringHeadline: "Structuring file",
    readingHeadline: "Reading file",
    structuringDetail: "Corpus has read the file and is preparing structured records.",
    readingDetail:
      "The file is queued for processing. Questions will appear here if clarification is needed.",
  },
  ru: {
    stages: {
      read: "Прочитал",
      structured: "Разобрал структуру",
      needs_input: "Вопросы",
      ready: "Готово",
    },
    failedHeadline: "Нужно проверить",
    failedDetail:
      "Corpus не смог надежно обработать файл. Откройте источник или запустите reprocess.",
    needsInputHeadline: "Есть вопрос по документу",
    clarificationOne: "уточнение",
    clarificationFew: "уточнения",
    clarificationOther: "уточнений",
    needsInputDetail: (count: number, label: string) =>
      `Corpus нужно ${count} ${label}, чтобы надежно закончить обработку.`,
    reviewHeadline: "Сохранено. Действий не нужно",
    reviewDetail:
      "Файл уже сохранен. Флаги только говорят Corpus использовать его осторожнее.",
    qaPendingHeadline: "Обработано, QA в очереди",
    qaPendingDetail:
      "Файл сохранен в память компании. QA еще проверяет результат.",
    readyHeadline: "Готово",
    readyDetail: "Файл обработан и готов для вопросов в Corpus.",
    suggestedQuestions: [
      "Покажи итоги по этому файлу",
      "Сравни с прошлым периодом",
      "Что здесь необычного?",
    ],
    structuringHeadline: "Разбираю структуру",
    readingHeadline: "Читаю файл",
    structuringDetail: "Corpus уже прочитал файл и готовит структурированные записи.",
    readingDetail:
      "Файл в очереди обработки. Вопросы появятся здесь, если нужны уточнения.",
  },
  id: {
    stages: {
      read: "Dibaca",
      structured: "Distrukturkan",
      needs_input: "Pertanyaan",
      ready: "Siap",
    },
    failedHeadline: "Perlu ditinjau",
    failedDetail:
      "Corpus tidak dapat memproses file ini dengan andal. Buka sumber atau jalankan reprocess.",
    needsInputHeadline: "Pertanyaan dokumen menunggu",
    clarificationOne: "klarifikasi",
    clarificationOther: "klarifikasi",
    needsInputDetail: (count: number, label: string) =>
      `Corpus perlu ${count} ${label} untuk menyelesaikan parsing yang andal.`,
    reviewHeadline: "Disimpan. Tidak perlu tindakan",
    reviewDetail:
      "File sudah tersimpan. Flag confidence hanya memberi tahu Corpus agar memakai file ini dengan hati-hati.",
    qaPendingHeadline: "Diproses, QA menunggu",
    qaPendingDetail:
      "File sudah disimpan ke memori perusahaan. QA masih memeriksa output.",
    readyHeadline: "Siap",
    readyDetail: "File sudah diproses dan siap untuk pertanyaan Corpus.",
    suggestedQuestions: [
      "Tampilkan ringkasan file ini",
      "Bandingkan dengan periode sebelumnya",
      "Apa yang tidak biasa di sini?",
    ],
    structuringHeadline: "Menyusun struktur file",
    readingHeadline: "Membaca file",
    structuringDetail:
      "Corpus sudah membaca file dan sedang menyiapkan catatan terstruktur.",
    readingDetail:
      "File masuk antrean pemrosesan. Pertanyaan akan muncul jika perlu klarifikasi.",
  },
} as const;

function getDocumentCardCopy(locale?: AppLocale | string | null) {
  return DOCUMENT_CARD_COPY[normalizeAppLocale(locale)];
}

function getClarificationLabel(
  count: number,
  locale: AppLocale | string | null | undefined,
  copy: ReturnType<typeof getDocumentCardCopy>,
): string {
  if (normalizeAppLocale(locale) === "ru") {
    if (count === 1) return DOCUMENT_CARD_COPY.ru.clarificationOne;
    if (count > 1 && count < 5) return DOCUMENT_CARD_COPY.ru.clarificationFew;
    return DOCUMENT_CARD_COPY.ru.clarificationOther;
  }
  return count === 1 ? copy.clarificationOne : copy.clarificationOther;
}

function isCoreProcessing(input: DocumentCardViewInput): boolean {
  return (
    input.status === "processing" ||
    input.codex?.stage === "queued" ||
    input.codex?.stage === "artifactizing" ||
    input.codex?.stage === "running" ||
    input.codex?.stage === "persisting" ||
    input.promotion?.stage === "running"
  );
}

function isAuditActive(input: DocumentCardViewInput): boolean {
  return (
    input.audit?.stage === "queued" ||
    input.audit?.stage === "artifactizing" ||
    input.audit?.stage === "running" ||
    input.audit?.stage === "persisting"
  );
}

function isFailed(input: DocumentCardViewInput): boolean {
  return (
    input.status === "failed" ||
    input.status === "rejected" ||
    input.codex?.stage === "failed" ||
    input.promotion?.stage === "failed" ||
    input.audit?.stage === "failed" ||
    input.audit?.overallStatus === "fail"
  );
}

function needsInput(input: DocumentCardViewInput): boolean {
  return (input.clarificationPendingCount ?? 0) > 0;
}

function needsManualReview(input: DocumentCardViewInput): boolean {
  return input.status === "needs_review" || input.reviewRequired === true;
}

function isStructurallyParsed(input: DocumentCardViewInput): boolean {
  return (
    input.codex?.stage === "completed" ||
    input.status === "completed" ||
    input.status === "needs_review" ||
    Boolean(input.promotion?.stage)
  );
}

function isReady(input: DocumentCardViewInput): boolean {
  if (isFailed(input) || needsInput(input) || needsManualReview(input) || isCoreProcessing(input) || isAuditActive(input)) return false;
  if (input.status !== "completed") return false;
  if (input.promotion?.stage && input.promotion.stage !== "completed") return false;
  if (input.audit?.stage && input.audit.stage !== "completed") return false;
  return true;
}

function buildStage(
  key: DocumentCardStageKey,
  state: DocumentCardStageState,
  copy: ReturnType<typeof getDocumentCardCopy>,
): DocumentCardStage {
  return {
    key,
    label: copy.stages[key],
    state,
  };
}

export function buildDocumentCardViewModel(
  input: DocumentCardViewInput,
  locale?: AppLocale | string | null,
): DocumentCardViewModel {
  const copy = getDocumentCardCopy(locale);

  if (isFailed(input)) {
    return {
      headline: copy.failedHeadline,
      detail: copy.failedDetail,
      tone: "failed",
      stages: [
        buildStage("read", isStructurallyParsed(input) ? "done" : "blocked", copy),
        buildStage("structured", "blocked", copy),
        buildStage("needs_input", "blocked", copy),
        buildStage("ready", "blocked", copy),
      ],
      suggestedQuestions: [],
    };
  }

  if (isCoreProcessing(input)) {
    const structurallyParsed = isStructurallyParsed(input);
    return {
      headline: structurallyParsed ? copy.structuringHeadline : copy.readingHeadline,
      detail: structurallyParsed
        ? copy.structuringDetail
        : copy.readingDetail,
      tone: "processing",
      stages: [
        buildStage("read", structurallyParsed ? "done" : "active", copy),
        buildStage("structured", structurallyParsed ? "active" : "pending", copy),
        buildStage("needs_input", "pending", copy),
        buildStage("ready", "pending", copy),
      ],
      suggestedQuestions: [],
    };
  }

  if (needsInput(input)) {
    const count = input.clarificationPendingCount ?? 0;
    const clarificationLabel = getClarificationLabel(count, locale, copy);
    return {
      headline: copy.needsInputHeadline,
      detail: copy.needsInputDetail(count, clarificationLabel),
      tone: "needs_input",
      stages: [
        buildStage("read", "done", copy),
        buildStage("structured", isStructurallyParsed(input) ? "done" : "active", copy),
        buildStage("needs_input", "active", copy),
        buildStage("ready", "pending", copy),
      ],
      suggestedQuestions: [],
    };
  }

  if (needsManualReview(input)) {
    return {
      headline: copy.reviewHeadline,
      detail: copy.reviewDetail,
      tone: "review",
      stages: [
        buildStage("read", "done", copy),
        buildStage("structured", isStructurallyParsed(input) ? "done" : "active", copy),
        buildStage("needs_input", "done", copy),
        buildStage("ready", isStructurallyParsed(input) ? "done" : "active", copy),
      ],
      suggestedQuestions: [],
    };
  }

  if (isAuditActive(input)) {
    return {
      headline: copy.qaPendingHeadline,
      detail: copy.qaPendingDetail,
      tone: "processing",
      stages: [
        buildStage("read", "done", copy),
        buildStage("structured", "done", copy),
        buildStage("needs_input", "done", copy),
        buildStage("ready", "active", copy),
      ],
      suggestedQuestions: [],
    };
  }

  if (isReady(input)) {
    return {
      headline: copy.readyHeadline,
      detail: copy.readyDetail,
      tone: "ready",
      stages: [
        buildStage("read", "done", copy),
        buildStage("structured", "done", copy),
        buildStage("needs_input", "done", copy),
        buildStage("ready", "done", copy),
      ],
      suggestedQuestions: [...copy.suggestedQuestions],
    };
  }

  const structurallyParsed = isStructurallyParsed(input);
  return {
    headline: structurallyParsed ? copy.structuringHeadline : copy.readingHeadline,
    detail: structurallyParsed
      ? copy.structuringDetail
      : copy.readingDetail,
    tone: "processing",
    stages: [
      buildStage("read", structurallyParsed ? "done" : "active", copy),
      buildStage("structured", structurallyParsed ? "active" : "pending", copy),
      buildStage("needs_input", "pending", copy),
      buildStage("ready", "pending", copy),
    ],
    suggestedQuestions: [],
  };
}
