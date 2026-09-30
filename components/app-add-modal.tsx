"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Landmark,
  Loader2,
  Mail,
  Plus,
  UploadCloud,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPTED_FORMATS = "PDF · XLSX · CSV · DOCX · OFX · TXT · Images";
const ACCEPTED_EXTENSIONS = ".pdf,.csv,.xlsx,.xls,.ofx,.qif,image/*,.txt,.md,.qmd,.html,.htm,.docx";

type UploadResult = {
  name: string;
  status: "success" | "error";
  error?: string;
};

type AddCopy = {
  trigger: string;
  title: string;
  subtitle: string;
  dropTitle: string;
  browse: string;
  uploading: string;
  accepted: string;
  sourceDivider: string;
  moreSources: string;
  cancel: string;
  askAfterUpload: string;
  openHistory: string;
  cards: Array<{
    title: string;
    outcome: string;
    description: string;
    href: string;
    icon: LucideIcon;
  }>;
};

function getCopy(locale: string): AddCopy {
  if (locale === "ru") {
    return {
      trigger: "Add",
      title: "Добавить данные",
      subtitle: "Перетащите файл прямо сюда или подключите источник.",
      dropTitle: "Перетащите файл сюда",
      browse: "выберите с компьютера",
      uploading: "Загружаем...",
      accepted: ACCEPTED_FORMATS,
      sourceDivider: "или подключите источник",
      moreSources: "Ещё 11 источников",
      cancel: "Отмена",
      askAfterUpload: "Спросить AI",
      openHistory: "История обработки",
      cards: [
        {
          title: "Банк",
          outcome: "реальный кэш-флоу",
          description: "Mercury сейчас, Plaid/TrueLayer через banking flow.",
          href: "/integrations#banking",
          icon: Landmark,
        },
        {
          title: "Google Drive",
          outcome: "архив документов",
          description: "Подключите папку и импортируйте выбранные файлы.",
          href: "/integrations#storage_documents",
          icon: Folder,
        },
        {
          title: "Email forward",
          outcome: "переслать счёт",
          description: "Получите ingest-адрес и allowlist отправителей.",
          href: "/integrations#collaboration",
          icon: Mail,
        },
      ],
    };
  }

  if (locale === "id") {
    return {
      trigger: "Add",
      title: "Tambahkan data",
      subtitle: "Tarik file ke sini atau hubungkan sumber data.",
      dropTitle: "Tarik file ke sini",
      browse: "pilih dari komputer",
      uploading: "Mengunggah...",
      accepted: ACCEPTED_FORMATS,
      sourceDivider: "atau hubungkan sumber",
      moreSources: "11 sumber lainnya",
      cancel: "Batal",
      askAfterUpload: "Tanya AI",
      openHistory: "Riwayat proses",
      cards: [
        {
          title: "Bank",
          outcome: "cash-flow nyata",
          description: "Mercury sekarang, Plaid/TrueLayer lewat banking flow.",
          href: "/integrations#banking",
          icon: Landmark,
        },
        {
          title: "Google Drive",
          outcome: "arsip dokumen",
          description: "Hubungkan folder dan impor file yang dipilih.",
          href: "/integrations#storage_documents",
          icon: Folder,
        },
        {
          title: "Email forward",
          outcome: "teruskan invoice",
          description: "Dapatkan alamat ingest dan allowlist pengirim.",
          href: "/integrations#collaboration",
          icon: Mail,
        },
      ],
    };
  }

  return {
    trigger: "Add",
    title: "Add data",
    subtitle: "Drop a file here or connect a source.",
    dropTitle: "Drop a file here",
    browse: "choose from computer",
    uploading: "Uploading...",
    accepted: ACCEPTED_FORMATS,
    sourceDivider: "or connect a source",
    moreSources: "11 more sources",
    cancel: "Cancel",
    askAfterUpload: "Ask AI",
    openHistory: "Processing history",
    cards: [
      {
        title: "Bank",
        outcome: "real cash-flow",
        description: "Mercury now, Plaid/TrueLayer through the banking flow.",
        href: "/integrations#banking",
        icon: Landmark,
      },
      {
        title: "Google Drive",
        outcome: "document archive",
        description: "Connect a folder and import selected files.",
        href: "/integrations#storage_documents",
        icon: Folder,
      },
      {
        title: "Email forward",
        outcome: "forward invoices",
        description: "Get an ingest address and sender allowlist.",
        href: "/integrations#collaboration",
        icon: Mail,
      },
    ],
  };
}

export function AppAddModal({
  triggerClassName,
  hideTriggerLabelOnMobile = true,
}: {
  triggerClassName?: string;
  hideTriggerLabelOnMobile?: boolean;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const copy = getCopy(locale);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const isPersonalSurface = pathname.startsWith("/personal");
  const uploadPath = isPersonalSurface ? "/api/personal/documents/upload" : "/api/documents/upload";
  const batchUploadPath = isPersonalSurface ? null : "/api/documents/batch-upload";
  const askAfterUploadHref = isPersonalSurface ? "/personal/chat" : "/assistant";
  const openHistoryHref = isPersonalSurface
    ? "/personal/documents"
    : "/documents?view=documents";

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadResults([]);
    const results: UploadResult[] = [];
    const fileList = Array.from(files);

    if (fileList.length === 1 || !batchUploadPath) {
      for (const file of fileList) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const response = await fetch(uploadPath, {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            results.push({
              name: file.name,
              status: "error",
              error:
                typeof payload.error === "string"
                  ? payload.error
                  : `Upload failed (${response.status})`,
            });
          } else {
            results.push({ name: file.name, status: "success" });
          }
        } catch {
          results.push({ name: file.name, status: "error", error: "Network error" });
        }
      }
    } else {
      try {
        const formData = new FormData();
        for (const file of fileList) {
          formData.append("files", file);
        }
        const response = await fetch(batchUploadPath, {
          method: "POST",
          body: formData,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error =
            typeof payload.error === "string"
              ? payload.error
              : `Upload failed (${response.status})`;
          for (const file of fileList) {
            results.push({ name: file.name, status: "error", error });
          }
        } else {
          const batchResults = Array.isArray(payload.results) ? payload.results : [];
          for (const file of fileList) {
            const fileResult = batchResults.find(
              (entry: { fileName?: unknown; error?: unknown }) =>
                entry.fileName === file.name,
            );
            results.push({
              name: file.name,
              status: fileResult?.error ? "error" : "success",
              error:
                typeof fileResult?.error === "string"
                  ? fileResult.error
                  : undefined,
            });
          }
        }
      } catch {
        for (const file of fileList) {
          results.push({ name: file.name, status: "error", error: "Network error" });
        }
      }
    }

    setUploadResults(results);
    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [batchUploadPath, uploadPath]);

  const successCount = uploadResults.filter((result) => result.status === "success").length;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          size="sm"
          className={cn("h-8 gap-1.5 px-2.5 sm:px-3", triggerClassName)}
          data-testid="app-add-trigger"
        >
          <Plus className="size-3.5" />
          <span className={hideTriggerLabelOnMobile ? "hidden sm:inline" : ""}>
            {copy.trigger}
          </span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-2xl border border-border bg-card p-0 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 sm:inset-x-auto sm:left-1/2 sm:top-8 sm:bottom-auto sm:w-[720px] sm:max-w-[calc(100vw-2rem)] sm:max-h-[calc(100vh-4rem)] sm:-translate-x-1/2 sm:rounded-xl sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div>
              <Dialog.Title className="text-lg font-semibold text-foreground">
                {copy.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {copy.subtitle}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close add data modal">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="space-y-5 px-5 py-5 sm:px-6">
            <div
              className={cn(
                "rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-8",
                dragOver
                  ? "border-primary/70 bg-primary/10"
                  : "border-primary/30 bg-primary/[0.04] hover:border-primary/50",
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                void handleUpload(event.dataTransfer.files);
              }}
            >
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                {uploading ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <UploadCloud className="size-6" />
                )}
              </div>
              <p className="text-sm font-medium text-foreground">
                {uploading ? copy.uploading : copy.dropTitle}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {copy.browse}
                </button>
              </p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                {copy.accepted}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={ACCEPTED_EXTENSIONS}
                multiple
                onChange={(event) => void handleUpload(event.target.files)}
              />
            </div>

            {uploadResults.length > 0 ? (
              <div className="space-y-2">
                {uploadResults.map((result, index) => (
                  <div
                    key={`${result.name}:${result.status}:${index}`}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                      result.status === "success"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-red-500/10 text-red-700 dark:text-red-300",
                    )}
                  >
                    {result.status === "success" ? (
                      <CheckCircle2 className="size-4 shrink-0" />
                    ) : (
                      <XCircle className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{result.name}</span>
                    {result.error ? (
                      <span className="shrink-0 text-xs">{result.error}</span>
                    ) : null}
                  </div>
                ))}
                {successCount > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm">
                      <Link href={askAfterUploadHref} onClick={() => setOpen(false)}>
                        <FileText className="size-4" />
                        {copy.askAfterUpload}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={openHistoryHref} onClick={() => setOpen(false)}>
                        {copy.openHistory}
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{copy.sourceDivider}</span>
              <div className="h-px flex-1 bg-border" aria-hidden />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {copy.cards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link
                    key={card.title}
                    href={card.href}
                    onClick={() => setOpen(false)}
                    className="group rounded-xl border border-border bg-background/60 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
                  >
                    <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <Icon className="size-4" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">{card.title}</p>
                    <p className="mt-1 text-xs font-medium text-primary">→ {card.outcome}</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {card.description}
                    </p>
                    <ChevronRight className="mt-3 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </div>

            <Button asChild variant="ghost" size="sm" className="px-0 text-muted-foreground">
              <Link href="/integrations" onClick={() => setOpen(false)}>
                <ChevronDown className="size-3.5" />
                {copy.moreSources}
              </Link>
            </Button>
          </div>

          <div className="flex justify-end border-t border-border px-5 py-3 sm:px-6">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">{copy.cancel}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
