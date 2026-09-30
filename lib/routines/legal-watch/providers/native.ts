import { fetchLegalWatchSource } from "@/lib/routines/legal-watch/collector";
import type { LegalWatchSourceProvider } from "@/lib/routines/legal-watch/providers/types";

export const nativeLegalWatchProvider: LegalWatchSourceProvider = {
  id: "native",
  fetchSource: (source, options) => fetchLegalWatchSource(source, options?.fetchImpl),
};
