import { WorkspaceShell } from "@/components/workspace-shell";

export default function AutomationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell requireCompanyProject enableGlobalAdd>
      {children}
    </WorkspaceShell>
  );
}
