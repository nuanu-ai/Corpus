import { processBatch, recoverStale } from "@/lib/workers/reconciliation";

export interface ReconciliationTriggerResult {
  processed: number;
  failed: number;
  skipped: number;
  recovered: number;
}

export async function triggerReconciliationForCompany(
  companySlug: string,
): Promise<ReconciliationTriggerResult> {
  const recovered = await recoverStale(companySlug);
  const result: ReconciliationTriggerResult = {
    processed: 0,
    failed: 0,
    skipped: 0,
    recovered,
  };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const batch = await processBatch(companySlug);
    result.processed += batch.processed;
    result.failed += batch.failed;
    result.skipped += batch.skipped;
    if (batch.processed === 0 && batch.failed === 0 && batch.skipped === 0) {
      break;
    }
  }

  return {
    ...result,
  };
}
