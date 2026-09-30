"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getAppCopy } from "@/lib/i18n/copy";
import { ConnectorCard } from "./connector-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CreditCard,
  Landmark,
  ShoppingCart,
  Calculator,
  Megaphone,
  HardDrive,
  MessageSquare,
  Users,
  BarChart3,
  PlugZap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  listIntegrationProviderCategories,
  type ConnectorProviderCategory,
} from "@/lib/connectors/provider-registry";

export type ConnectorStatus = "available" | "coming-soon";

type ConnectorCategory = {
  key: ConnectorProviderCategory;
  label: string;
  icon: LucideIcon;
  connectors: Array<{
    name: string;
    description: string;
    providerSlug?: string;
    status: ConnectorStatus;
    usesOAuthInUi: boolean;
  }>;
};

const CATEGORY_ICONS: Record<ConnectorProviderCategory, LucideIcon> = {
  payments: CreditCard,
  banking: Landmark,
  commerce: ShoppingCart,
  accounting: Calculator,
  ads: Megaphone,
  storage_documents: HardDrive,
  analytics: BarChart3,
  people_support: Users,
  collaboration: MessageSquare,
  custom_integrations: PlugZap,
};

export function AddSourceGrid({
  onConnected,
  connectedProviders = [],
}: {
  onConnected?: () => void;
  connectedProviders?: string[];
}) {
  const locale = useLocale();
  const sectionsCopy = getAppCopy(locale).integrations.page.sections;
  const categories = useMemo<ConnectorCategory[]>(
    () =>
      listIntegrationProviderCategories().map((category) => ({
        key: category.key,
        label: category.label,
        icon: CATEGORY_ICONS[category.key],
        connectors: category.providers.map((provider) => ({
          name: provider.label,
          description: provider.description,
          providerSlug: provider.slug,
          status: provider.integrationStatus,
          usesOAuthInUi: provider.usesOAuthInUi,
        })),
      })),
    [],
  );
  const [providerStatus, setProviderStatus] = useState<
    Record<string, { configured: boolean }> | null
  >(null);
  const [inactiveSelection, setInactiveSelection] = useState<string>();

  useEffect(() => {
    fetch("/api/connections/providers/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProviderStatus(data))
      .catch(() => {});
  }, []);

  function getOAuthConfigured(connector: ConnectorCategory["connectors"][number]): boolean | null {
    if (connector.status === "coming-soon") return null;
    if (!connector.usesOAuthInUi) return null;
    if (!providerStatus || !connector.providerSlug) return null;
    return providerStatus[connector.providerSlug]?.configured ?? null;
  }

  const activeCategories = categories
    .map((category) => ({
      ...category,
      connectors: category.connectors.filter(
        (connector) => connector.status === "available",
      ),
    }))
    .filter((category) => category.connectors.length > 0);

  const inactiveConnectors = categories.flatMap((category) =>
    category.connectors
      .filter((connector) => connector.status !== "available")
      .map((connector) => ({
        category: category.label,
        name: connector.name,
        description: connector.description,
        status: connector.status,
      })),
  );

  const selectedInactive = inactiveConnectors.find(
    (item) => `${item.category}::${item.name}` === inactiveSelection,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{sectionsCopy.addMore}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        {activeCategories.map((category) => {
          const CategoryIcon = category.icon;
          return (
            <div key={category.key} id={category.key} className="scroll-mt-24">
              {/* Section header — icon, label, then a hairline rule that
                  flows to the right edge to anchor the category visually
                  without competing with the cards below. */}
              <div className="mb-3 flex items-center gap-2.5">
                <CategoryIcon className="size-3.5 text-muted-foreground/80" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {category.label}
                </p>
                <div className="h-px flex-1 bg-border/50" aria-hidden />
                <span className="text-[10px] tabular-nums text-muted-foreground/60">
                  {category.connectors.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {category.connectors.map((connector) => {
                  const isAlreadyConnected = !!(
                    connector.providerSlug && connectedProviders.includes(connector.providerSlug)
                  );
                  return (
                    <ConnectorCard
                      key={connector.name}
                      name={connector.name}
                      description={connector.description}
                      icon={category.icon}
                      providerSlug={connector.providerSlug}
                      connectorStatus={connector.status}
                      oauthConfigured={getOAuthConfigured(connector)}
                      onConnected={onConnected}
                      alreadyConnected={isAlreadyConnected}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {inactiveConnectors.length > 0 && (
          <div className="space-y-3 border-t border-border/60 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {sectionsCopy.inactive}
            </p>
            <Select value={inactiveSelection} onValueChange={setInactiveSelection}>
              <SelectTrigger className="w-full sm:w-[360px]">
                <SelectValue
                  placeholder={sectionsCopy.inactiveSelectPlaceholder.replace(
                    "{count}",
                    String(inactiveConnectors.length),
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {inactiveConnectors.map((item) => (
                  <SelectItem
                    key={`${item.category}::${item.name}`}
                    value={`${item.category}::${item.name}`}
                  >
                    {item.name} - {item.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedInactive && (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">{selectedInactive.name}</p>
                <p className="text-xs text-muted-foreground">{selectedInactive.description}</p>
                <p className="mt-1 text-xs capitalize text-muted-foreground">
                  Status: {selectedInactive.status.replace("-", " ")}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
