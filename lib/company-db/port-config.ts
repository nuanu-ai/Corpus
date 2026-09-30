/**
 * Single source of truth for Company-DB port layout.
 *
 * Every tenant daemon occupies a triplet of consecutive ports starting at
 * its `company_db_port` (stored per-company in the database). The base port
 * hosts the REST API; +1 is the write queue; +2 is the MCP transport.
 *
 * `STRIDE = 3` is what the allocator uses when assigning a new tenant's
 * base port: 3100, 3103, 3106, … (see `pickNextCompanyDbPort`).
 *
 * Reserve external conflicts via the `COMPANY_DB_RESERVED_PORTS` env var
 * (comma-separated). The allocator skips any candidate whose triplet
 * overlaps a reserved port.
 */
export const COMPANY_DB_PORTS = {
  REST: 3100,
  QUEUE: 3101,
  MCP: 3102,
  STRIDE: 3,
} as const;

export const DEFAULT_COMPANY_DB_REST_PORT = COMPANY_DB_PORTS.REST;
export const DEFAULT_COMPANY_DB_QUEUE_PORT = COMPANY_DB_PORTS.QUEUE;
export const DEFAULT_COMPANY_DB_MCP_PORT = COMPANY_DB_PORTS.MCP;
export const COMPANY_DB_PORT_STRIDE = COMPANY_DB_PORTS.STRIDE;

export function queuePortFor(restPort: number): number {
  return restPort + 1;
}

export function mcpPortFor(restPort: number): number {
  return restPort + 2;
}
