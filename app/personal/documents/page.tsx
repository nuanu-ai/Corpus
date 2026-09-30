import { FileText } from "lucide-react";

import { PersonalDocumentsView } from "@/app/personal/_components/personal-documents-view";

export default function PersonalDocumentsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <FileText className="size-3.5" />
          Personal documents
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Personal documents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload and manage documents that belong to your personal project instead of a company tenant.
          </p>
        </div>
      </div>

      <PersonalDocumentsView />
    </div>
  );
}
