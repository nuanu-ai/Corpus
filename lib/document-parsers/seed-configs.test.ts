import { describe, expect, it } from "vitest";

import { ALL_SEED_CONFIGS, getSeedConfig } from "./seed-configs";

describe("synthetic report seed configs", () => {
  it("publishes only the three documented Northstar examples", () => {
    expect(ALL_SEED_CONFIGS).toHaveLength(3);
    expect(getSeedConfig("example-northstar", "profit_and_loss")).not.toBeNull();
    expect(getSeedConfig("example-northstar", "balance_sheet")).not.toBeNull();
    expect(getSeedConfig("example-northstar", "trial_balance")).not.toBeNull();
  });

  it("does not provide hidden company-specific shortcuts", () => {
    expect(getSeedConfig("unknown-company", "profit_and_loss")).toBeNull();
  });
});
