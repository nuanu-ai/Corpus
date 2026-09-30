"use client";

// Inline renderer for tool results carrying `action: "company_db_result"`.
// Ported from app/dashboard/_components/chat-panel.tsx renderCompanyDbToolPreview
// (~line 867). Re-implemented as a standalone component so this module does
// not import from dashboard/_components.

import { useLocale } from "next-intl";

import { getAppCopy } from "@/lib/i18n/copy";

import {
  isRecord,
  toNumber,
  toText,
} from "@/app/assistant/_lib/normalizers";
import {
  buildCompanyDbResultMeta,
  extractStringList,
  filterRecords,
  MAX_COMPANY_DB_RESULT_PREVIEW,
} from "@/app/assistant/_lib/tool-output-utils";

export interface CompanyDbResultCardProps {
  result: Record<string, unknown>;
}

export function CompanyDbResultCard({ result }: CompanyDbResultCardProps) {
  const locale = useLocale();
  const copy = getAppCopy(locale).chat.v2.tool;

  const action = toText(result.action) ?? "company_db_result";
  const errorText = toText(result.error);
  const results = filterRecords(result.results);
  const count = toNumber(result.count) ?? results.length;

  const query = toText(result.query);
  const domain = toText(result.domain);
  const typeField = toText(result.type);

  const headline =
    action === "company_db_search"
      ? copy.companyDbResult.searchTitleFormat.replace(
          "{query}",
          query ?? copy.companyDbResult.defaultQuery,
        )
      : copy.companyDbResult.queryTitleFormat
          .replace("{domain}", domain ?? copy.companyDbResult.defaultDomain)
          .replace(
            "{type}",
            typeField && typeField !== "all" ? ` / ${typeField}` : "",
          );

  const statusLabel = errorText
    ? copy.companyDbResult.statusError
    : copy.companyDbResult.statusCountFormat
        .replace("{count}", String(count))
        .replace(
          "{plural}",
          count === 1 ? "" : copy.companyDbResult.pluralSuffix,
        );

  return (
    <details
      open={Boolean(errorText) || count > 0}
      className="my-2 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
    >
      <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
        {headline}
        <span className="ml-2 text-muted-foreground">{statusLabel}</span>
      </summary>

      <div className="mt-3 space-y-2">
        {errorText ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {errorText}
          </div>
        ) : results.length === 0 ? (
          <div className="text-muted-foreground">
            {copy.companyDbResult.empty}
          </div>
        ) : (
          <>
            {results.slice(0, MAX_COMPANY_DB_RESULT_PREVIEW).map((hit, index) => (
              <CompanyDbResultHit
                key={toText(hit.id) ?? `hit-${index}`}
                hit={hit}
                index={index}
              />
            ))}
            {count > results.length && (
              <div className="text-muted-foreground">
                {copy.companyDbResult.truncatedFormat
                  .replace("{shown}", String(results.length))
                  .replace("{total}", String(count))}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function CompanyDbResultHit({
  hit,
  index,
}: {
  hit: Record<string, unknown>;
  index: number;
}) {
  const locale = useLocale();
  const copy = getAppCopy(locale).chat.v2.tool;

  const titleText =
    toText(hit.title) ??
    toText(hit.account_name) ??
    toText(hit.id) ??
    copy.companyDbResult.hitFallbackFormat.replace("{index}", String(index + 1));
  const meta = buildCompanyDbResultMeta(hit);
  const filePath = toText(hit.filePath);
  const entityId = toText(hit.id);
  const managerialSummary = toText(hit.managerialSummary);
  const highlights = extractStringList(hit.highlights, 2);
  const risks = extractStringList(hit.risks, 1);

  return (
    <div className="min-w-0 rounded-lg border border-border/50 bg-background/70 px-3 py-2">
      <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
        {titleText}
      </div>
      {meta.length > 0 && (
        <div className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">
          {meta.join(" · ")}
        </div>
      )}
      {entityId && (
        <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
          {entityId}
        </div>
      )}
      {managerialSummary && (
        <div className="mt-2 break-words text-muted-foreground [overflow-wrap:anywhere]">
          {managerialSummary}
        </div>
      )}
      {highlights.length > 0 && (
        <div className="mt-2 space-y-1">
          {highlights.map((highlight) => (
            <div
              key={`${entityId ?? index}-${highlight}`}
              className="break-words text-muted-foreground [overflow-wrap:anywhere]"
            >
              - {highlight}
            </div>
          ))}
        </div>
      )}
      {risks.length > 0 && (
        <div className="mt-2 break-words text-destructive/90 [overflow-wrap:anywhere]">
          {copy.companyDbResult.riskFormat.replace("{risk}", risks[0]!)}
        </div>
      )}
      {filePath && (
        <div className="mt-1 font-mono text-[11px] text-primary/90 break-all">
          {filePath}
        </div>
      )}
    </div>
  );
}

// Type-narrow helper: prevents "property 'action' does not exist" style errors
// when passing a raw result through the fallback.
export function isCompanyDbResultAction(action: string | null): boolean {
  return action === "company_db_result" || action === "company_db_search";
}

export function toCompanyDbResultPayload(
  value: unknown,
): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
