import { apifyLegalWatchProvider } from "@/lib/routines/legal-watch/providers/apify";
import { nativeLegalWatchProvider } from "@/lib/routines/legal-watch/providers/native";
import type { LegalWatchProviderFetchOptions } from "@/lib/routines/legal-watch/providers/types";
import { readLegalWatchSourceProviderConfig } from "@/lib/routines/source-config";
import type { RoutineSourceDefinition } from "@/lib/routines/source-registry";
import type { RoutineSourceFetchResult } from "@/lib/routines/types";

export { fetchLegalWatchSourceViaApify } from "@/lib/routines/legal-watch/providers/apify";
export type {
  LegalWatchCollectorProvider,
  LegalWatchProviderFetchOptions,
  LegalWatchSourceProvider,
} from "@/lib/routines/legal-watch/providers/types";

export function getLegalWatchCollectorProviderId(source: RoutineSourceDefinition) {
  return readLegalWatchSourceProviderConfig(source).collectorProvider;
}

export async function fetchLegalWatchSourceWithProvider(
  source: RoutineSourceDefinition,
  options?: LegalWatchProviderFetchOptions,
): Promise<RoutineSourceFetchResult> {
  const providerId = getLegalWatchCollectorProviderId(source);
  if (providerId === "apify") return apifyLegalWatchProvider.fetchSource(source, options);
  return nativeLegalWatchProvider.fetchSource(source, options);
}
