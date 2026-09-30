export function tokenExpiresAtFromExpiresIn(
  expiresIn: unknown,
  now = Date.now()
): string | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }

  return new Date(now + expiresIn * 1000).toISOString();
}
