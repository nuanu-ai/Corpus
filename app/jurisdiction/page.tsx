"use client";

import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Star,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Shield,
} from "lucide-react";
import {
  jurisdictions,
  getRecommendedJurisdiction,
  type Jurisdiction,
} from "@/lib/jurisdictions";
import { useCFOStore } from "@/lib/store";

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs >= 1000 ? `$${abs.toLocaleString("en-US")}` : `$${abs}`;
  return amount < 0 ? `-${formatted}` : formatted;
}

function getBankingBadgeClasses(ease: Jurisdiction["bankingEase"]): string {
  switch (ease) {
    case "Easy":
      return "bg-green-500/20 text-green-400";
    case "Medium":
      return "bg-yellow-500/20 text-yellow-400";
    case "Hard":
      return "bg-red-500/20 text-red-400";
  }
}

function getCryptoBadgeClasses(
  friendliness: Jurisdiction["cryptoFriendliness"]
): string {
  switch (friendliness) {
    case "Friendly":
      return "bg-green-500/20 text-green-400";
    case "Medium":
      return "bg-yellow-500/20 text-yellow-400";
    case "Complex":
    case "Restricted":
      return "bg-red-500/20 text-red-400";
  }
}

export default function JurisdictionPage() {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const userProfile = useCFOStore((s) => s.userProfile);
  const recommended = getRecommendedJurisdiction();

  const toggleRow = (id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Jurisdiction Navigator
          </h1>
          <p className="mt-2 text-muted-foreground">
            Based on your profile: {userProfile.company.type},{" "}
            {userProfile.revenueRange}, living in {userProfile.livingCountry}
          </p>
        </div>

        {/* AI Recommendation Card */}
        <Card className="mb-8 border-primary/50 bg-card/80 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Star className="h-5 w-5 fill-primary text-primary" />
              <span>
                Recommended: {recommended.flag} {recommended.name}
              </span>
              <Badge className="ml-2 bg-primary/20 text-primary">
                AI Pick
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {recommended.corpTaxNote}. Low setup cost ({formatCurrency(recommended.setupCost)})
              with easy banking access and crypto-friendly regulations — ideal
              for a {userProfile.company.type} business at your revenue level.
            </p>
            <Separator className="my-3" />
            <p className="text-sm font-medium">
              Estimated annual savings:{" "}
              <span className="text-green-400">
                {formatCurrency(recommended.estimatedSavings)}
              </span>{" "}
              vs current ({userProfile.company.jurisdiction})
            </p>
          </CardContent>
        </Card>

        {/* Comparison Table */}
        <Card className="border-border/50 bg-card/80">
          <CardHeader>
            <CardTitle className="text-lg">
              Compare All Jurisdictions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left">
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Jurisdiction
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Corp Tax
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Setup Cost
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Annual Cost
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Banking
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Crypto
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Tax Reporting
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground">
                      Annual Savings
                    </th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {jurisdictions.map((j, index) => {
                    const isRecommended = j.id === recommended.id;
                    const isExpanded = expandedRow === j.id;

                    return (
                      <Fragment key={j.id}>
                        <tr
                          onClick={() => toggleRow(j.id)}
                          className={`cursor-pointer border-b border-border/30 transition-colors hover:bg-secondary/30 ${
                            isRecommended
                              ? "bg-primary/5 hover:bg-primary/10"
                              : index % 2 === 0
                                ? "bg-transparent"
                                : "bg-secondary/10"
                          }`}
                        >
                          <td className="whitespace-nowrap px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{j.flag}</span>
                              <span className="font-medium text-foreground">
                                {j.name}
                              </span>
                              {isRecommended && (
                                <Star className="h-3.5 w-3.5 fill-primary text-primary" />
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground">
                            {j.corpTaxRate}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground">
                            {formatCurrency(j.setupCost)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground">
                            {formatCurrency(j.ongoingCostYear)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <Badge
                              className={`border-0 ${getBankingBadgeClasses(j.bankingEase)}`}
                            >
                              {j.bankingEase}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <Badge
                              className={`border-0 ${getCryptoBadgeClasses(j.cryptoFriendliness)}`}
                            >
                              {j.cryptoFriendliness}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground">
                            {j.taxReporting}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span
                              className={
                                j.estimatedSavings >= 0
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {j.estimatedSavings >= 0 ? "+" : ""}
                              {formatCurrency(j.estimatedSavings)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </td>
                        </tr>

                        {/* Expanded Details */}
                        {isExpanded && (
                          <tr
                            className={
                              isRecommended ? "bg-primary/5" : "bg-secondary/5"
                            }
                          >
                            <td colSpan={9} className="px-4 py-5">
                              <div className="grid gap-6 md:grid-cols-3">
                                {/* Pros */}
                                <div>
                                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-green-400">
                                    <Check className="h-4 w-4" />
                                    Pros
                                  </h4>
                                  <ul className="space-y-1">
                                    {j.pros.map((pro) => (
                                      <li
                                        key={pro}
                                        className="text-sm text-muted-foreground"
                                      >
                                        {pro}
                                      </li>
                                    ))}
                                  </ul>
                                </div>

                                {/* Cons */}
                                <div>
                                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-red-400">
                                    <X className="h-4 w-4" />
                                    Cons
                                  </h4>
                                  <ul className="space-y-1">
                                    {j.cons.map((con) => (
                                      <li
                                        key={con}
                                        className="text-sm text-muted-foreground"
                                      >
                                        {con}
                                      </li>
                                    ))}
                                  </ul>
                                </div>

                                {/* Details */}
                                <div>
                                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                                    <Shield className="h-4 w-4" />
                                    Details
                                  </h4>
                                  <div className="space-y-2 text-sm">
                                    {j.specialRegime && (
                                      <div>
                                        <span className="text-muted-foreground">
                                          Special Regime:{" "}
                                        </span>
                                        <span className="text-foreground">
                                          {j.specialRegime}
                                        </span>
                                      </div>
                                    )}
                                    {j.corpTaxNote && (
                                      <div>
                                        <span className="text-muted-foreground">
                                          Tax Notes:{" "}
                                        </span>
                                        <span className="text-foreground">
                                          {j.corpTaxNote}
                                        </span>
                                      </div>
                                    )}
                                    <div>
                                      <span className="text-muted-foreground">
                                        Reporting:{" "}
                                      </span>
                                      <span className="text-foreground">
                                        {j.taxReporting}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
