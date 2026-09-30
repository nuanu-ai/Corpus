import { desc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { landingLeads } from "@/lib/db/schema";
import { getPlatformAdminSession } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

function formatDate(value: Date | string | null): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatIntent(value: string): string {
  switch (value) {
    case "team_trial":
      return "Team trial";
    case "holding_contact":
      return "Holding contact";
    default:
      return value;
  }
}

export default async function MarketingLeadsPage() {
  const session = await getPlatformAdminSession();
  if (!session?.user) {
    redirect("/dashboard");
  }

  const leads = await db
    .select({
      id: landingLeads.id,
      intent: landingLeads.intent,
      plan: landingLeads.plan,
      email: landingLeads.email,
      name: landingLeads.name,
      companyName: landingLeads.companyName,
      message: landingLeads.message,
      locale: landingLeads.locale,
      path: landingLeads.path,
      utmSource: landingLeads.utmSource,
      utmMedium: landingLeads.utmMedium,
      utmCampaign: landingLeads.utmCampaign,
      createdAt: landingLeads.createdAt,
    })
    .from(landingLeads)
    .orderBy(desc(landingLeads.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Marketing</p>
          <h1 className="text-2xl font-semibold tracking-tight">Landing leads</h1>
        </div>
        <Link href="/admin" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
          Back to admin
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
          Last {leads.length} pricing CTA leads
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Intent</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">UTM</th>
                <th className="px-4 py-3 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No landing leads yet.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDate(lead.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{formatIntent(lead.intent)}</div>
                      <div className="text-xs text-muted-foreground">{lead.plan ?? "-"}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">{lead.email}</td>
                    <td className="px-4 py-3">{lead.name ?? "-"}</td>
                    <td className="px-4 py-3">{lead.companyName ?? "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {[lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(" / ") || "-"}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-muted-foreground">
                      {lead.message ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
