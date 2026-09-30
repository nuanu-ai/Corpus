import { documentEventName } from "@/lib/documents";
import { resolveFlagForCompany } from "@/lib/inngest/document-routing";

export type DocumentIngressEventName =
  | "document/ingress-received"
  | "document/knowledge-uploaded"
  | "document/uploaded";

export type DocumentShadowEventName = "document/simplified-narrative-shadowed";

export type DocumentIngressLikeEventName =
  | DocumentIngressEventName
  | DocumentShadowEventName;

export interface DocumentIngressEventInput {
  documentId: string;
  companyId: string;
  fileType: string;
  storageKey?: string | null;
  storageUrl?: string | null;
  approved?: boolean;
  reprocess?: boolean;
}

type DocumentIngressLikeEventPayload = {
  documentId: string;
  companyId: string;
  fileType: string;
  storageKey?: string;
  storageUrl?: string;
  approved?: true;
  reprocess?: true;
};

export interface DocumentIngressLikeEvent {
  name: DocumentIngressLikeEventName;
  data: DocumentIngressLikeEventPayload;
}

function envFlagEnabled(name: string): boolean {
  return process.env[name] === "true";
}

function normalizeStorageKey(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isInngestProcessor(): boolean {
  const processor = process.env.CORPUS_DOCUMENT_PROCESSOR;
  if (processor && !["inngest", "codex"].includes(processor)) {
    throw new Error("CORPUS_DOCUMENT_PROCESSOR must be inngest or codex.");
  }
  return processor === "inngest";
}

export function shouldUsePostIngressDispatch(input: {
  companyId: string;
  fileType: string;
}): boolean {
  if (isInngestProcessor()) return true;
  const canaryEnabled = resolveFlagForCompany(
    envFlagEnabled("INGEST_PRECODEX_TRIAGE_V1"),
    input.companyId,
    process.env.INGEST_CANARY_COMPANY_IDS,
  );

  if (!canaryEnabled) {
    return false;
  }

  if (input.fileType === "knowledge") {
    return true;
  }

  if (input.fileType === "pdf") {
    return envFlagEnabled("INGEST_PRECODEX_PDF_V1");
  }

  return false;
}

export function shouldRunSimplifiedNarrativeShadow(input: {
  companyId: string;
  fileType: string;
}): boolean {
  if (input.fileType !== "pdf") {
    return false;
  }

  const shadowEnabled = resolveFlagForCompany(
    envFlagEnabled("INGEST_SIMPLIFIED_NARRATIVE_SHADOW_V1"),
    input.companyId,
    process.env.INGEST_CANARY_COMPANY_IDS,
  );

  if (!shadowEnabled) {
    return false;
  }

  return !shouldUsePostIngressDispatch(input);
}

export function resolveDocumentIngressEventName(input: {
  companyId: string;
  fileType: string;
}): DocumentIngressEventName {
  // The self-hosted path uses the existing knowledge/structured document
  // handlers directly; Codex triage remains available to configured workers.
  if (isInngestProcessor()) {
    return documentEventName(input.fileType) as DocumentIngressEventName;
  }
  if (shouldUsePostIngressDispatch(input)) {
    return "document/ingress-received";
  }
  const eventName = documentEventName(input.fileType);
  if (eventName === "document/knowledge-uploaded") {
    return eventName;
  }
  return "document/uploaded";
}

export function buildDocumentIngressEvent(input: DocumentIngressEventInput): {
  name: DocumentIngressEventName;
  data: DocumentIngressLikeEventPayload;
} {
  const storageKey =
    normalizeStorageKey(input.storageKey) ?? normalizeStorageKey(input.storageUrl);
  const storageUrl = normalizeStorageKey(input.storageUrl);
  const data: {
    documentId: string;
    companyId: string;
    fileType: string;
    storageKey?: string;
    storageUrl?: string;
    approved?: true;
    reprocess?: true;
  } = {
    documentId: input.documentId,
    companyId: input.companyId,
    fileType: input.fileType,
  };

  if (storageKey) {
    data.storageKey = storageKey;
  }

  if (storageUrl) {
    data.storageUrl = storageUrl;
  }

  if (input.approved) {
    data.approved = true;
  }

  if (input.reprocess) {
    data.reprocess = true;
  }

  return {
    name: resolveDocumentIngressEventName(input),
    data,
  };
}

export function buildSimplifiedNarrativeShadowEvent(
  input: DocumentIngressEventInput,
): DocumentIngressLikeEvent | null {
  if (
    !shouldRunSimplifiedNarrativeShadow({
      companyId: input.companyId,
      fileType: input.fileType,
    })
  ) {
    return null;
  }

  const storageKey =
    normalizeStorageKey(input.storageKey) ?? normalizeStorageKey(input.storageUrl);
  const storageUrl = normalizeStorageKey(input.storageUrl);

  const data: DocumentIngressLikeEventPayload = {
    documentId: input.documentId,
    companyId: input.companyId,
    fileType: input.fileType,
  };

  if (storageKey) {
    data.storageKey = storageKey;
  }

  if (storageUrl) {
    data.storageUrl = storageUrl;
  }

  if (input.reprocess) {
    data.reprocess = true;
  }

  return {
    name: "document/simplified-narrative-shadowed",
    data,
  };
}
