import { afterEach, expect, it, vi } from "vitest";
import { resolveDocumentIngressEventName, shouldUsePostIngressDispatch } from "./document-ingress-events";

afterEach(() => vi.unstubAllEnvs());

it("routes self-hosted text and structured uploads to existing handlers without Codex canary flags", () => {
  vi.stubEnv("CORPUS_DOCUMENT_PROCESSOR", "inngest");
  vi.stubEnv("INGEST_PRECODEX_TRIAGE_V1", "");
  for (const [fileType, event] of [["knowledge", "document/knowledge-uploaded"], ["csv", "document/uploaded"], ["pdf", "document/uploaded"]]) {
    const input = { companyId: "synthetic-company", fileType };
    expect(shouldUsePostIngressDispatch(input)).toBe(true);
    expect(resolveDocumentIngressEventName(input)).toBe(event);
  }
});
