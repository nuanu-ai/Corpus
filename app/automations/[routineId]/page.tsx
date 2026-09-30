import { RoutineDetail } from "./_components/routine-detail";

export default async function RoutineDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ routineId: string }>;
  searchParams?: Promise<{ companyId?: string | string[] }>;
}) {
  const { routineId } = await params;
  const query = searchParams ? await searchParams : {};
  const rawCompanyId = query.companyId;
  const companyId = Array.isArray(rawCompanyId)
    ? rawCompanyId[0] ?? null
    : rawCompanyId ?? null;

  return <RoutineDetail routineId={routineId} companyId={companyId} />;
}
