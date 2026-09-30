"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { X } from "lucide-react";

type ToastVariant = "default" | "error" | "success";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (message: string, options?: { variant?: ToastVariant; action?: Toast["action"] }) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let globalToastFn: ToastContextValue["toast"] | null = null;

/**
 * Show a toast from anywhere (including non-component code).
 * Must be called after <ToastProvider> is mounted.
 */
export function showToast(
  message: string,
  options?: { variant?: ToastVariant; action?: Toast["action"] }
) {
  if (globalToastFn) {
    globalToastFn(message, options);
  } else {
    console.warn("[toast] ToastProvider not mounted yet");
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast: ToastContextValue["toast"] = useCallback((message, options) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, variant: options?.variant ?? "default", action: options?.action }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Auto-dismiss after 5s
  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(() => removeToast(latest.id), 5000);
    return () => clearTimeout(timer);
  }, [toasts, removeToast]);

  // Register global function
  useEffect(() => {
    globalToastFn = addToast;
    return () => {
      globalToastFn = null;
    };
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`
              flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm
              animate-in slide-in-from-bottom-2 fade-in-0 duration-200
              ${
                t.variant === "error"
                  ? "bg-destructive/10 border-destructive/30 text-destructive"
                  : t.variant === "success"
                    ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                    : "bg-card border-border text-foreground"
              }
            `}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick();
                  removeToast(t.id);
                }}
                className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => removeToast(t.id)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
