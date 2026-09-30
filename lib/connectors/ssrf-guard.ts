/**
 * SSRF denylist guard (SEC-2a — cheap tier).
 *
 * Pure hostname / literal-IP validation for user-supplied connector URLs.
 * Rejects schemes that are not http(s) and hosts that resolve *literally* to
 * loopback, link-local, RFC-1918 private, IPv6 unique-local, or unspecified
 * (0.0.0.0 / ::) ranges. This catches the obvious `http://localhost:8288`-style
 * pivot against services co-located on the box.
 *
 * IMPORTANT — this tier does NOT perform DNS resolution. A hostname like
 * `evil.example.com` that resolves to a private IP at request time (DNS
 * rebinding) is NOT caught here. Socket-level pinned-connect re-validation of
 * the resolved IP at connect time is tracked separately as SEC-2b and requires
 * a custom undici dispatcher threaded through each transport. Until SEC-2b
 * ships, treat this as best-effort denial of the literal cases only.
 */

const DENIED_HOSTNAMES = new Set<string>([
  "localhost",
  "0.0.0.0",
  "[::]",
  "::",
  "[::1]",
  "::1",
]);

/** Parse a dotted-quad IPv4 string into four octets, or null if not IPv4. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1, 5).map((part) => Number(part));
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return [octets[0], octets[1], octets[2], octets[3]];
}

/** True if a literal IPv4 address falls in a denied range. */
function isDeniedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  // 0.0.0.0/8 (unspecified / "this host")
  if (a === 0) return true;
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 10.0.0.0/8 RFC-1918
  if (a === 10) return true;
  // 172.16.0.0/12 RFC-1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 RFC-1918
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Normalize an IPv6 host. URL hostnames keep brackets for IPv6 literals
 * (e.g. `[::1]`); strip them and lowercase for comparison.
 */
function normalizeIpv6(host: string): string | null {
  const trimmed = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  if (!trimmed.includes(":")) return null;
  return trimmed.toLowerCase();
}

/** True if a literal IPv6 address falls in a denied range. */
function isDeniedIpv6(addr: string): boolean {
  // Loopback ::1 (and any all-zero-then-1 expansion)
  if (addr === "::1") return true;
  // Unspecified ::
  if (addr === "::") return true;
  // Link-local fe80::/10 — first 10 bits are 1111111010 → fe80..febf
  if (/^fe[89ab][0-9a-f]?:/.test(addr) || /^fe[89ab]:/.test(addr)) return true;
  // Unique-local fc00::/7 → fc.. and fd..
  if (/^f[cd][0-9a-f]*:/.test(addr)) return true;
  // IPv4-mapped IPv6 — re-check the embedded IPv4. WHATWG URL normalizes the
  // dotted form (::ffff:127.0.0.1) to compressed hex (::ffff:7f00:1), so match
  // the trailing 32 bits as either dotted-quad or two hex groups.
  const v4 = extractMappedIpv4(addr);
  if (v4 && isDeniedIpv4(v4)) return true;
  return false;
}

/**
 * Extract the embedded IPv4 from an IPv4-mapped (::ffff:a.b.c.d / ::ffff:hhhh:hhhh)
 * IPv6 address, or null if not such a mapping.
 */
function extractMappedIpv4(
  addr: string,
): [number, number, number, number] | null {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (dotted) return parseIpv4(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
  }
  return null;
}

/**
 * Throws if the given URL targets a denied scheme or a literal address in a
 * loopback / link-local / private / unique-local / unspecified range.
 *
 * @param rawUrl   The user-supplied URL (string or URL).
 * @param context  Short label for error messages (e.g. "Odoo portal URL").
 */
export function assertUrlNotSsrf(
  rawUrl: string | URL,
  context = "Connector URL",
): void {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  } catch {
    throw new Error(`${context} is not a valid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${context} must use http or https`);
  }

  // URL.hostname lowercases registered names but preserves IPv6 brackets.
  // Strip a single trailing dot: the absolute-FQDN form `localhost.` resolves
  // to the same address as `localhost`, so it must hit the same denylist.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) {
    throw new Error(`${context} must include a host`);
  }

  if (DENIED_HOSTNAMES.has(hostname)) {
    throw new Error(
      `${context} resolves to a blocked address (${hostname})`,
    );
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isDeniedIpv4(ipv4)) {
    throw new Error(
      `${context} resolves to a blocked private/loopback address (${hostname})`,
    );
  }

  const ipv6 = normalizeIpv6(url.hostname);
  if (ipv6 && isDeniedIpv6(ipv6)) {
    throw new Error(
      `${context} resolves to a blocked private/loopback address (${url.hostname})`,
    );
  }
}
