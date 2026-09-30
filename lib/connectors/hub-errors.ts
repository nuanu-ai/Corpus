export class ConnectorHubError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    message: string,
    options?: { status?: number; code?: string; details?: unknown }
  ) {
    super(message);
    this.name = "ConnectorHubError";
    this.status = options?.status ?? 500;
    this.code = options?.code ?? "connector_hub_error";
    this.details = options?.details;
  }
}
