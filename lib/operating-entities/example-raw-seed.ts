import type { OperatingEntitySourceRow } from "./types";

const SOURCE = "synthetic-example-v1";

function row(
  rowNumber: number,
  project: string,
  legalEntity = "",
  alias = "",
  ...notes: string[]
): OperatingEntitySourceRow {
  return { source: SOURCE, rowNumber, project, legalEntity, alias, notes };
}

/** Synthetic data that does not map to a real customer or company. */
export const EXAMPLE_STRUCTURE_ROWS: OperatingEntitySourceRow[] = [
  row(1, "Example Holdings", "Example Holdings Ltd", "Example Holdings Group"),
  row(2, "Project Northstar", "Example Holdings Ltd", "Northstar"),
  row(3, "Project Beacon", "Example Holdings Ltd", "Beacon"),
  row(4, "Finance", "Example Holdings Ltd", "Finance Department"),
  row(5, "Example Partner", "", "Partner Co"),
];
