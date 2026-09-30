import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.aws.internal",
]);

const LOCALHOST_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

function normalizeHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
  return bytes;
}

function isBlockedIpv4(value: string): boolean {
  const bytes = parseIpv4(value);
  if (!bytes) return false;
  const [a, b] = bytes;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv4BytesFromGroups(groups: number[]): number[] | null {
  if (groups.length !== 8) return null;
  if (groups.slice(0, 5).some((group) => group !== 0) || groups[5] !== 0xffff) {
    return null;
  }
  return [
    (groups[6] >> 8) & 0xff,
    groups[6] & 0xff,
    (groups[7] >> 8) & 0xff,
    groups[7] & 0xff,
  ];
}

function parseIpv6Groups(value: string): number[] | null {
  const [address] = value.split("%");
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const groups: number[] = [];
    for (const part of side.split(":")) {
      if (!part) return null;
      if (part.includes(".")) {
        const ipv4 = parseIpv4(part);
        if (!ipv4) return null;
        groups.push((ipv4[0] << 8) + ipv4[1], (ipv4[2] << 8) + ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const left = parseSide(halves[0] ?? "");
  const right = parseSide(halves[1] ?? "");
  if (!left || !right) return null;

  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0) return null;
  const groups = halves.length === 2
    ? [...left, ...Array.from({ length: missing }, () => 0), ...right]
    : left;
  return groups.length === 8 ? groups : null;
}

function isBlockedIpv6(value: string): boolean {
  const groups = parseIpv6Groups(value);
  if (!groups) return false;
  const first = groups[0];
  const second = groups[1];
  const allZero = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const mappedIpv4 = ipv4BytesFromGroups(groups);
  return (
    allZero ||
    loopback ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (mappedIpv4 ? isBlockedIpv4(mappedIpv4.join(".")) : false) ||
    (first === 0xfd00 && second === 0x0ec2 && groups.slice(2, 7).every((group) => group === 0) && groups[7] === 0x0254)
  );
}

function isBlockedIpAddress(value: string): boolean {
  const ipVersion = isIP(normalizeHostname(value));
  if (ipVersion === 4) return isBlockedIpv4(normalizeHostname(value));
  if (ipVersion === 6) return isBlockedIpv6(normalizeHostname(value));
  return false;
}

export function assertLegalWatchSafeHttpsUrl(value: string | URL, label = "url"): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must use https`);
  }

  const hostname = normalizeHostname(url.hostname);
  const ipVersion = isIP(hostname);
  const unsafeHostname =
    LOCALHOST_HOSTS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    METADATA_HOSTS.has(hostname);
  const unsafeIp =
    ipVersion === 4
      ? isBlockedIpv4(hostname)
      : ipVersion === 6
        ? isBlockedIpv6(hostname)
        : false;

  if (unsafeHostname || unsafeIp) {
    throw new Error(`${label} must not target localhost, private, link-local, or metadata hosts`);
  }

  url.hash = "";
  return url;
}

export type LegalWatchHostnameResolver = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string }>>;

async function defaultResolveHostname(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function assertLegalWatchSafeResolvedHttpsUrl(
  value: string | URL,
  label = "url",
  options?: {
    resolveHostname?: LegalWatchHostnameResolver;
  },
): Promise<URL> {
  const url = assertLegalWatchSafeHttpsUrl(value, label);
  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname)) return url;

  const resolveHostname = options?.resolveHostname ?? defaultResolveHostname;
  let records: ReadonlyArray<{ address: string }>;
  try {
    records = await resolveHostname(hostname);
  } catch {
    throw new Error(`${label} hostname could not be resolved to public internet`);
  }

  if (records.length === 0 || records.some((record) => isBlockedIpAddress(record.address))) {
    throw new Error(`${label} hostname must resolve to public internet addresses`);
  }

  return url;
}
