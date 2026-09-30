import { AutomationsList } from "./_components/automations-list";

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ companyId?: string | string[] }>;
}) {
  const query = searchParams ? await searchParams : {};
  const rawCompanyId = query.companyId;
  const initialCompanyId = Array.isArray(rawCompanyId)
    ? rawCompanyId[0] ?? null
    : rawCompanyId ?? null;

  return <AutomationsList initialCompanyId={initialCompanyId} />;
}
