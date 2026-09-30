import { describe, expect, it } from "vitest";

import { resolveReportBuiltInSources } from "./report-sources";

describe("report source policy", () => {
  it("uses safe built-in defaults", () => {
    expect(resolveReportBuiltInSources(undefined)).toEqual([
      "company_db",
      "odoo",
      "documents",
    ]);
  });

  it("ignores unknown source identifiers", () => {
    expect(
      resolveReportBuiltInSources({ builtInSources: ["company_db", "unknown"] }),
    ).toEqual(["company_db"]);
  });
});
