import { describe, expect, it } from "vitest";

import {
  buildOperatingEntityRegistry,
  expandOperatingEntitySearchTerms,
  resolveOperatingEntity,
} from "./registry";

describe("synthetic operating entity registry", () => {
  it("contains only the documented example organization", () => {
    const registry = buildOperatingEntityRegistry();

    expect(registry.records).toHaveLength(5);
    expect(registry.records.every((record) => record.tags.includes("synthetic"))).toBe(true);
    expect(registry.recordsById.get("domain:example-holdings")?.canonicalName).toBe(
      "Example Holdings",
    );
  });

  it("resolves aliases and expands linked entity names", () => {
    expect(resolveOperatingEntity("Northstar")?.record.id).toBe("project:northstar");
    expect(expandOperatingEntitySearchTerms("Northstar")).toEqual(
      expect.arrayContaining(["Project Northstar", "Example Holdings Ltd"]),
    );
  });
});
