import { OdooMcpClient, type ValidationResult } from "./odoo-mcp-client";

export async function validateOdooConnection(
  portalUrl: string,
  token: string,
): Promise<ValidationResult> {
  const client = new OdooMcpClient(portalUrl, token);
  try {
    await client.connect();
    const result = await client.validateConnection();
    return result;
  } catch (err) {
    return {
      valid: false,
      tools: [],
      error: err instanceof Error ? err.message : "Connection failed",
    };
  } finally {
    await client.disconnect();
  }
}
