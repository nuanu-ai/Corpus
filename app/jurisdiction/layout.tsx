"use client";

import { useEffect, useState } from "react";

import { AppHeader } from "@/components/app-header";

export default function JurisdictionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState("User");
  const [userEmail, setUserEmail] = useState<string | undefined>();

  useEffect(() => {
    const sessionCheck = fetch("/api/auth/get-session")
      .then((response) => response.json())
      .then((data) => {
        if (data?.user?.name) setUserName(data.user.name);
        if (data?.user?.email) setUserEmail(data.user.email);
      })
      .catch(() => {});

    sessionCheck.finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <AppHeader userName={userName} userEmail={userEmail} />
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  );
}
