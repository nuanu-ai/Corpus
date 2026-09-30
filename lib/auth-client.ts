import { createAuthClient } from "better-auth/react";

function resolveAuthBaseUrl(): string {
  // In the browser always use the current origin.
  // This prevents hard-coded localhost URLs in production client bundles.
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  );
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseUrl(),
});

type AuthErrorPayload =
  | { error?: string | { message?: string } | null }
  | null;

async function authJsonPost(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${resolveAuthBaseUrl()}/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as AuthErrorPayload;
  if (!response.ok) {
    const errorValue = payload?.error;
    const message =
      typeof errorValue === "string"
        ? errorValue
        : errorValue && typeof errorValue === "object" && typeof errorValue.message === "string"
          ? errorValue.message
          : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}) {
  await authJsonPost("/change-password", {
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    revokeOtherSessions: input.revokeOtherSessions ?? true,
  });
}
