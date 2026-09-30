import { afterEach, expect, it, vi } from "vitest";
import { validateEnv } from "./env";

afterEach(() => vi.unstubAllEnvs());

it.each(["1", "true", "http://127.0.0.1:8288"])("rejects production development execution (%s) even with signing credentials", (mode) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("INNGEST_DEV", mode);
  vi.stubEnv("INNGEST_SIGNING_KEY", "synthetic-signing-value");
  expect(validateEnv().errors.some((error) => error.startsWith("INNGEST_DEV"))).toBe(true);
});

it("rejects an unknown processor instead of silently queueing to a different worker", () => {
  vi.stubEnv("CORPUS_DOCUMENT_PROCESSOR", "misspelled-processor");
  expect(validateEnv().errors).toContain("CORPUS_DOCUMENT_PROCESSOR must be inngest or codex.");
});
