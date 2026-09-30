export interface CorpusDestinations {
  dashboardUrl: string;
  documentsUrl: string;
  companyMapUrl: string;
}

export function buildCorpusDestinations(
  baseUrl: string,
  companySlug: string | null | undefined,
): CorpusDestinations {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const companyParam =
    typeof companySlug === "string" && companySlug.trim().length > 0
      ? `?company=${encodeURIComponent(companySlug.trim())}`
      : "";

  return {
    dashboardUrl: `${normalizedBaseUrl}/dashboard`,
    documentsUrl: `${normalizedBaseUrl}/documents`,
    companyMapUrl: `${normalizedBaseUrl}/admin/company-db${companyParam}`,
  };
}
