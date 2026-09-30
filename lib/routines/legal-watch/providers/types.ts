import type { RoutineSourceFetchResult } from "@/lib/routines/types";
import type { RoutineSourceDefinition } from "@/lib/routines/source-registry";

export type LegalWatchCollectorProvider = "native" | "apify";

export interface LegalWatchProviderFetchOptions {
  fetchImpl?: typeof fetch;
}

export interface LegalWatchSourceProvider {
  readonly id: LegalWatchCollectorProvider;
  fetchSource(
    source: RoutineSourceDefinition,
    options?: LegalWatchProviderFetchOptions,
  ): Promise<RoutineSourceFetchResult>;
}
