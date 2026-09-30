import { afterEach, expect, it, vi } from "vitest";
import { isCompanyDbReady } from "./readiness";

afterEach(() => vi.unstubAllGlobals());

it("does not accept a healthy service belonging to a different tenant", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "ok", tenantSlug: "other-company" })));
  expect(await isCompanyDbReady(4100, "example-company")).toBe(false);
});

it("requires a ready listener and the expected tenant identity", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "ok", tenantSlug: "example-company" })));
  expect(await isCompanyDbReady(4100, "example-company")).toBe(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "starting", tenantSlug: "example-company" }, { status: 503 })));
  expect(await isCompanyDbReady(4100, "example-company")).toBe(false);
});
