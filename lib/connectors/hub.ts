import {
  getLatestConnectionCredentialsByProvider,
  listConnections,
} from "@/lib/connections";
import { ConnectorHubError } from "@/lib/connectors/hub-errors";
import {
  executeSlackHubAction,
  slackHubDefinition,
} from "@/lib/connectors/slack-hub";
import {
  executeJiraHubAction,
  jiraHubDefinition,
} from "@/lib/connectors/jira-hub";

export type ConnectorHubProvider = "slack" | "jira";

const connectorHubCatalog = {
  slack: slackHubDefinition,
  jira: jiraHubDefinition,
} as const satisfies Record<
  ConnectorHubProvider,
  {
    provider: ConnectorHubProvider;
    label: string;
    description: string;
    actions: readonly { name: string; description: string }[];
  }
>;

function pickLatestConnection<T extends { provider: string; createdAt: Date | string }>(
  connections: T[],
  provider: string
) {
  return connections
    .filter((connection) => connection.provider === provider)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0] ?? null;
}

export async function getConnectorHubStatus(companyId: string) {
  const connections = await listConnections(companyId);

  return Object.values(connectorHubCatalog).map((definition) => {
    const connection = pickLatestConnection(connections, definition.provider);
    return {
      provider: definition.provider,
      label: definition.label,
      description: definition.description,
      connected: !!connection,
      actions: definition.actions,
      connection: connection
        ? {
            id: connection.id,
            status: connection.status,
            metadata: connection.metadata,
            connectedAt: connection.createdAt,
            lastSyncAt: connection.lastSyncAt,
          }
        : null,
    };
  });
}

export async function executeConnectorHubAction(
  companyId: string,
  payload: {
    provider?: unknown;
    action?: unknown;
    input?: unknown;
  }
) {
  if (typeof payload.provider !== "string" || payload.provider.length === 0) {
    throw new ConnectorHubError("provider is required", {
      status: 400,
      code: "missing_provider",
    });
  }
  if (typeof payload.action !== "string" || payload.action.length === 0) {
    throw new ConnectorHubError("action is required", {
      status: 400,
      code: "missing_action",
    });
  }

  const provider = payload.provider as ConnectorHubProvider;
  if (!(provider in connectorHubCatalog)) {
    throw new ConnectorHubError(`Unsupported connector provider: ${payload.provider}`, {
      status: 400,
      code: "unsupported_provider",
    });
  }

  const connection = await getLatestConnectionCredentialsByProvider(companyId, provider);
  if (!connection) {
    throw new ConnectorHubError(`${provider} is not connected for this company`, {
      status: 404,
      code: "provider_not_connected",
    });
  }

  const result =
    provider === "slack"
      ? await executeSlackHubAction(connection, payload.action, payload.input)
      : await executeJiraHubAction(connection, payload.action, payload.input);

  return {
    provider,
    action: payload.action,
    connectionId: connection.id,
    result,
  };
}

export function getConnectorHubCatalog() {
  return Object.values(connectorHubCatalog);
}
