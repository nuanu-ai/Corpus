export function filterNewCanonicalTxnWriteInputs<
  TTxn extends { sourceRef?: string | null },
  TStaging,
>(input: {
  rows: TTxn[];
  stagingRows: TStaging[];
  existingSourceRefs: Array<string | null | undefined>;
}): {
  rowsToInsert: TTxn[];
  stagingRowsToInsert: TStaging[];
} {
  const existingSourceRefs = new Set(
    input.existingSourceRefs.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );

  const rowsToInsert = input.rows.filter(
    (row) => !row.sourceRef || !existingSourceRefs.has(row.sourceRef),
  );
  const insertedSourceRefs = new Set(
    rowsToInsert
      .map((row) => row.sourceRef)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const stagingRowsToInsert = input.stagingRows.filter((_, index) => {
    const sourceRef = input.rows[index]?.sourceRef;
    return !sourceRef || insertedSourceRefs.has(sourceRef);
  });

  return {
    rowsToInsert,
    stagingRowsToInsert,
  };
}

export function planCanonicalTxnReplayWrites<
  TTxn extends { sourceRef?: string | null },
  TStaging,
>(input: {
  rows: TTxn[];
  stagingRows: TStaging[];
  existingSourceRefs: Array<string | null | undefined>;
  replaceExisting: boolean;
}): {
  rowsToInsert: TTxn[];
  rowsToUpdate: TTxn[];
  stagingRowsToInsert: TStaging[];
} {
  const existingSourceRefs = new Set(
    input.existingSourceRefs.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );

  if (!input.replaceExisting) {
    const filtered = filterNewCanonicalTxnWriteInputs({
      rows: input.rows,
      stagingRows: input.stagingRows,
      existingSourceRefs: Array.from(existingSourceRefs),
    });
    return {
      ...filtered,
      rowsToUpdate: [],
    };
  }

  const rowsToUpdate = input.rows.filter(
    (row) => Boolean(row.sourceRef && existingSourceRefs.has(row.sourceRef)),
  );
  const rowsToInsert = input.rows.filter(
    (row) => !row.sourceRef || !existingSourceRefs.has(row.sourceRef),
  );

  return {
    rowsToInsert,
    rowsToUpdate,
    stagingRowsToInsert: input.stagingRows,
  };
}
