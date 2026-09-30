import { resolveTrustedAppBaseUrl } from "@/lib/embed-config";

const MCP_OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"] as const;
const MCP_OAUTH_CLAIMS = [
  "sub",
  "iss",
  "aud",
  "exp",
  "nbf",
  "iat",
  "jti",
  "email",
  "email_verified",
  "name",
] as const;

function resolvePublicAppOrigin(requestOrigin: string | null | undefined): string {
  return resolveTrustedAppBaseUrl(requestOrigin);
}

export function resolveChatgptMcpPublicOrigin(
  requestOrigin: string | null | undefined,
): string {
  return resolvePublicAppOrigin(requestOrigin);
}

export function buildChatgptMcpResourceUrl(
  requestOrigin: string | null | undefined,
  companySlug: string,
): string {
  return `${resolvePublicAppOrigin(requestOrigin)}/api/chatgpt/mcp-v3/${companySlug}`;
}

export function buildChatgptMcpProtectedResourceMetadataUrl(
  requestOrigin: string | null | undefined,
  companySlug: string,
): string {
  return `${buildChatgptMcpResourceUrl(requestOrigin, companySlug)}/.well-known/oauth-protected-resource`;
}

export function buildOAuthAuthorizationServerMetadata(
  requestOrigin: string | null | undefined,
) {
  const origin = resolvePublicAppOrigin(requestOrigin);

  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/auth/mcp/authorize`,
    token_endpoint: `${origin}/api/auth/mcp/token`,
    userinfo_endpoint: `${origin}/api/auth/mcp/userinfo`,
    jwks_uri: `${origin}/api/auth/mcp/jwks`,
    registration_endpoint: `${origin}/api/auth/mcp/register`,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "none"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    claims_supported: [...MCP_OAUTH_CLAIMS],
  };
}

export function buildOAuthProtectedResourceMetadata(
  requestOrigin: string | null | undefined,
  resource: string,
) {
  const origin = resolvePublicAppOrigin(requestOrigin);

  return {
    resource,
    authorization_servers: [origin],
    jwks_uri: `${origin}/api/auth/mcp/jwks`,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_signing_alg_values_supported: ["RS256", "none"],
  };
}

export function buildOAuthMetadataHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function buildOAuthMetadataOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: buildOAuthMetadataHeaders(),
  });
}
