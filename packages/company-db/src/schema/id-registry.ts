import { TYPE_PREFIXES, type QualifiedId } from "./types.js";

export interface IdRegistry {
  sequences: Record<string, number>;
}

export function createIdRegistry(): IdRegistry {
  return { sequences: {} };
}

export function allocateId(registry: IdRegistry, prefix: string): string {
  const config = TYPE_PREFIXES[prefix];
  if (!config) {
    throw new Error(`Unknown type prefix: ${prefix}`);
  }

  const current = registry.sequences[prefix] ?? 0;
  const next = current + 1;
  registry.sequences[prefix] = next;

  const padded = String(next).padStart(config.padding, "0");
  return `${prefix}-${padded}`;
}

export function qualifyId(id: string, entitySlug: string): string {
  return `${entitySlug}:${id}`;
}

const ID_PATTERN = /^(?:([a-z0-9-]+):)?([a-z]+)-(\d+)$/;

export function parseQualifiedId(input: string): QualifiedId | null {
  if (!input) return null;

  const match = input.match(ID_PATTERN);
  if (!match) return null;

  const prefix = match[2];
  const number = parseInt(match[3], 10);

  if (!(prefix in TYPE_PREFIXES)) return null;

  return { prefix, number, raw: input };
}

export function isValidId(input: string): boolean {
  return parseQualifiedId(input) !== null;
}
