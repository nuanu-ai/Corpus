/**
 * Type declarations for @modelcontextprotocol/sdk/client/sse
 *
 * The MCP SDK v1.27+ has the SSE transport at ./dist/esm/client/sse.js
 * and exposes it via the "./*" wildcard export. However, TypeScript's
 * bundler moduleResolution doesn't always resolve the .d.ts through
 * wildcard exports. This declaration bridges the gap.
 */
declare module "@modelcontextprotocol/sdk/client/sse" {
  import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

  export class SSEClientTransport implements Transport {
    constructor(url: URL, options?: {
      eventSourceInit?: {
        fetch?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
      };
      requestInit?: RequestInit;
    });
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    close(): Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
  }
}
