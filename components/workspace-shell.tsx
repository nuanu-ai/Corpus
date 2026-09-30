"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppAddModal } from "@/components/app-add-modal";
import { AppMobileTabBar } from "@/components/app-mobile-tab-bar";
import { cn } from "@/lib/utils";

const MOBILE_TAB_BAR_HEIGHT = "calc(4.75rem + env(safe-area-inset-bottom))";

export function WorkspaceShell({
  children,
  mainClassName,
  requireCompanyProject = false,
  enableGlobalAdd = false,
}: {
  children: React.ReactNode;
  mainClassName?: string;
  requireCompanyProject?: boolean;
  enableGlobalAdd?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState("User");
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const isChatRoute =
    pathname === "/personal/chat" ||
    pathname === "/assistant" ||
    pathname.startsWith("/assistant/");
  const shellStyle = {
    "--app-mobile-tab-bar-height": MOBILE_TAB_BAR_HEIGHT,
    ...(enableGlobalAdd && isChatRoute
      ? {
          "--chat-composer-bottom": MOBILE_TAB_BAR_HEIGHT,
          "--chat-composer-safe-bottom": "0px",
          "--chat-viewport-bottom-extra": MOBILE_TAB_BAR_HEIGHT,
        }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [sessionRes, projectRes] = await Promise.all([
          fetch("/api/auth/get-session"),
          requireCompanyProject
            ? fetch("/api/projects/active", { cache: "no-store" })
            : Promise.resolve(null),
        ]);

        const sessionData = await sessionRes.json().catch(() => null);
        if (cancelled) return;
        if (sessionData?.user?.name) setUserName(sessionData.user.name);
        if (sessionData?.user?.email) setUserEmail(sessionData.user.email);

        if (requireCompanyProject && projectRes?.ok) {
          const projectData = await projectRes.json().catch(() => null);
          if (cancelled) return;
          if (projectData?.activeProjectKind === "personal") {
            router.replace("/personal");
            return;
          }
        }
      } catch {
        // noop
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [requireCompanyProject, router]);

  if (!ready) {
    return (
      <div className="flex h-dvh min-h-dvh items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-dvh flex-col bg-background" style={shellStyle}>
      <AppHeader
        userName={userName}
        userEmail={userEmail}
        primaryAction={enableGlobalAdd ? <AppAddModal /> : undefined}
      />
      <main
        className={cn(
          "min-h-0 flex-1 overflow-y-auto p-6",
          mainClassName,
          enableGlobalAdd &&
            !isChatRoute &&
            "pb-[calc(var(--app-mobile-tab-bar-height)+1rem)] md:pb-6",
          enableGlobalAdd && isChatRoute && "overflow-hidden p-0",
        )}
      >
        {children}
      </main>
      {enableGlobalAdd ? <AppMobileTabBar /> : null}
    </div>
  );
}
