"use client";

import Link from "next/link";
import { Inbox, CalendarDays, Rows3, BriefcaseBusiness, ListTodo } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PERSONAL_SURFACES = [
  {
    href: "/personal/inbox",
    title: "Inbox",
    description: "Untriaged personal signals and routed intake.",
    icon: Inbox,
  },
  {
    href: "/personal/today",
    title: "Today",
    description: "What matters now across your personal operating system.",
    icon: CalendarDays,
  },
  {
    href: "/personal/timeline",
    title: "Timeline",
    description: "Chronological context across your personal tenant.",
    icon: Rows3,
  },
  {
    href: "/personal/workspaces",
    title: "Workspaces",
    description: "Linked companies and operating contexts.",
    icon: BriefcaseBusiness,
  },
  {
    href: "/personal/commitments",
    title: "Commitments",
    description: "Promises, deadlines, and open follow-through.",
    icon: ListTodo,
  },
] as const;

export function PersonalOperatingNav() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {PERSONAL_SURFACES.map((surface) => {
        const Icon = surface.icon;
        return (
          <Link key={surface.href} href={surface.href} className="block">
            <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-card/80">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4" />
                  {surface.title}
                </CardTitle>
                <CardDescription>{surface.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Open surface
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
