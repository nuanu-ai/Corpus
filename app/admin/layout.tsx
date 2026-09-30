import { WorkspaceShell } from "@/components/workspace-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceShell requireCompanyProject enableGlobalAdd mainClassName="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-7xl min-w-0">{children}</div>
    </WorkspaceShell>
  );
}
