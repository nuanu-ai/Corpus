export function isMcpOAuthLoginRequest(searchParams: URLSearchParams): boolean {
  return (
    searchParams.get("response_type") === "code" &&
    Boolean(searchParams.get("client_id")) &&
    Boolean(searchParams.get("redirect_uri"))
  );
}

export function buildMcpAuthorizeResumeUrl(
  searchParams: URLSearchParams,
  authBasePath = "/api/auth",
): string | null {
  if (!isMcpOAuthLoginRequest(searchParams)) return null;
  const query = searchParams.toString();
  return `${authBasePath}/mcp/authorize${query ? `?${query}` : ""}`;
}
