import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { getEmbedFrameAncestors } from "./lib/embed-config";

function buildContentSecurityPolicy(frameAncestors: string) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.anthropic.com https://*.vercel-insights.com https://*.vercel-analytics.com",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const sharedSecurityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy("'none'"),
  },
];

const strictSecurityHeaders = [...sharedSecurityHeaders];

const embedSecurityHeaders = [
  ...sharedSecurityHeaders.filter((header) => header.key !== "Content-Security-Policy"),
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(getEmbedFrameAncestors()),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    // Next.js proxy request limit defaults to 10MB.
    // Keep slightly above our per-file validation limit (25MB).
    proxyClientMaxBodySize: "30mb",
  },
  typescript: {
    ignoreBuildErrors: process.env.ALLOW_NEXT_BUILD_WITH_TYPECHECK_ERRORS === "1",
  },
  async headers() {
    return [
      {
        source: "/embed/chat",
        headers: embedSecurityHeaders,
      },
      {
        source: "/login",
        headers: embedSecurityHeaders,
      },
      {
        source: "/((?!(?:embed/chat|login)$).*)",
        headers: strictSecurityHeaders,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
