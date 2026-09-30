const LOCAL_EMBED_ORIGINS = [
  "http://127.0.0.1:3101",
  "http://localhost:3101",
  "http://127.0.0.1:3102",
  "http://localhost:3102",
] as const;

export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function parseOrigins(csv: string | undefined): string[] {
  if (!csv) return [];
  const origins = new Set<string>();
  for (const candidate of csv.split(",")) {
    const origin = normalizeOrigin(candidate.trim());
    if (origin) origins.add(origin);
  }
  return [...origins];
}

export function getEmbedAllowedOrigins(
  raw = process.env.CORPUS_EMBED_ALLOWED_ORIGINS,
): string[] {
  return parseOrigins(raw);
}

export function getAllowedEmbedOrigin(
  origin: string | null | undefined,
  rawOrigins = process.env.CORPUS_EMBED_ALLOWED_ORIGINS,
): string | null {
  const normalizedOrigin = normalizeOrigin(origin ?? undefined);
  if (!normalizedOrigin) return null;
  const allowedOrigins = new Set(getEmbedNavigationAllowedOrigins(process.env.NODE_ENV, rawOrigins));
  return allowedOrigins.has(normalizedOrigin) ? normalizedOrigin : null;
}

export function buildCredentialedCorsHeaders(
  origin: string | null | undefined,
  rawOrigins = process.env.CORPUS_EMBED_ALLOWED_ORIGINS,
): HeadersInit {
  const allowedOrigin = getAllowedEmbedOrigin(origin, rawOrigins);
  if (!allowedOrigin) {
    return {
      Vary: "Origin",
    };
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    Vary: "Origin",
  };
}

export function getEmbedNavigationAllowedOrigins(
  nodeEnv = process.env.NODE_ENV,
  rawOrigins = process.env.CORPUS_EMBED_ALLOWED_ORIGINS,
): string[] {
  const defaults = nodeEnv === "production" ? [] : [...LOCAL_EMBED_ORIGINS];
  return Array.from(new Set([...defaults, ...getEmbedAllowedOrigins(rawOrigins)]));
}

export function getEmbedFrameAncestors(
  nodeEnv = process.env.NODE_ENV,
  rawOrigins = process.env.CORPUS_EMBED_ALLOWED_ORIGINS,
): string {
  const allowedOrigins = Array.from(
    new Set(["'self'", ...getEmbedNavigationAllowedOrigins(nodeEnv, rawOrigins)]),
  );
  return allowedOrigins.join(" ");
}

export function getEmbedCompatibleCookieAttributes(
  nodeEnv = process.env.NODE_ENV,
): {
  sameSite: "lax" | "none";
  secure: boolean;
} {
  if (nodeEnv === "production") {
    return {
      sameSite: "none",
      secure: true,
    };
  }

  return {
    sameSite: "lax",
    secure: false,
  };
}

export function collectTrustedOriginsFromEnv(): string[] {
  const origins = new Set<string>();

  const candidates = [
    "https://corpus.example",
    "https://www.corpus.example",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BETTER_AUTH_URL,
    ...parseOrigins(process.env.TRUSTED_ORIGINS),
    ...getEmbedNavigationAllowedOrigins(),
  ];

  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin) origins.add(origin);
  }

  return [...origins];
}

export function getTrustedAppOrigins(
  nodeEnv = process.env.NODE_ENV,
): string[] {
  const origins = new Set<string>([
    "https://corpus.example",
    "https://www.corpus.example",
  ]);

  if (nodeEnv !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  const configuredOrigins = [
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
    normalizeOrigin(process.env.BETTER_AUTH_URL),
  ];
  for (const origin of configuredOrigins) {
    if (origin) origins.add(origin);
  }

  return [...origins];
}

export function resolveTrustedAppBaseUrl(
  requestOrigin: string | null | undefined,
  nodeEnv = process.env.NODE_ENV,
): string {
  const configuredOrigin =
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeOrigin(process.env.BETTER_AUTH_URL);
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin ?? undefined);
  if (normalizedRequestOrigin) {
    const trustedOrigins = new Set(getTrustedAppOrigins(nodeEnv));
    if (trustedOrigins.has(normalizedRequestOrigin)) {
      return normalizedRequestOrigin;
    }
  }

  throw new Error(
    "NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL must be configured to resolve the public app URL",
  );
}

export function sanitizeEmbedTargetPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

export function sanitizeEmbedReturnUrl(
  value: string | null | undefined,
  nodeEnv = process.env.NODE_ENV,
  rawOrigins = process.env.CORPUS_EMBED_ALLOWED_ORIGINS,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowedOrigins = new Set(getEmbedNavigationAllowedOrigins(nodeEnv, rawOrigins));
    if (!allowedOrigins.has(url.origin)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export { LOCAL_EMBED_ORIGINS };
