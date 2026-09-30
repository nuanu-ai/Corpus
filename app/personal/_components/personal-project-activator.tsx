"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  PROJECTS_CHANGED_EVENT,
  type ProjectsChangedDetail,
} from "@/lib/project-context";

interface ProjectSummary {
  id: string;
  name: string;
  role: string;
  projectKind: "company" | "personal";
}

export function PersonalProjectActivator() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname.startsWith("/personal")) return;

    let cancelled = false;

    const activate = async () => {
      try {
        const projectsRes = await fetch("/api/projects", { cache: "no-store" });
        if (!projectsRes.ok) return;
        const payload = await projectsRes.json().catch(() => null);
        if (cancelled || !payload) return;

        const projects = Array.isArray(payload.projects)
          ? (payload.projects as ProjectSummary[])
          : [];
        const personalProject =
          projects.find((project) => project.projectKind === "personal") ?? null;

        if (!personalProject || payload.activeProjectId === personalProject.id) {
          return;
        }

        const switchRes = await fetch("/api/projects/active", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: personalProject.id }),
        });
        if (!switchRes.ok || cancelled) return;

        window.dispatchEvent(
          new CustomEvent<ProjectsChangedDetail>(PROJECTS_CHANGED_EVENT, {
            detail: {
              activeProjectId: personalProject.id,
              project: personalProject,
            },
          }),
        );
        router.refresh();
      } catch {
        // noop
      }
    };

    void activate();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
