"use client";

import { Megaphone } from "lucide-react";
import { EmptyState } from "./empty-state";

export function ROASView() {
  return (
    <EmptyState
      icon={Megaphone}
      title="Connect ad platforms to see ROAS"
      description="Connect Google Ads, Meta Ads, or other ad platforms to see real Return on Ad Spend with hidden costs factored in."
      actionLabel="Connect ad platform"
      actionHref="/integrations"
    />
  );
}
