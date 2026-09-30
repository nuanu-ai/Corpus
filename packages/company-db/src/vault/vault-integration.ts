import type { PiiVault } from "./pii-vault.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VAULT_PREFIX = "vault:";

// ---------------------------------------------------------------------------
// processVaultRefs
// ---------------------------------------------------------------------------

/**
 * Scan frontmatter for fields ending in `_ref` and either store plain values
 * in the vault (store mode) or resolve vault references back to plaintext
 * (resolve mode).
 *
 * **store** mode (entity create/update):
 *   - `_ref` fields with a `vault:` prefix are left as-is (already stored)
 *   - `_ref` fields with a plain string are encrypted via `vault.storeSecret`
 *     and replaced with the resulting `vault:entityId:field` reference
 *
 * **resolve** mode (entity read at API layer):
 *   - `_ref` fields with a `vault:` prefix are resolved to plaintext
 *   - Other `_ref` fields are passed through unchanged
 *
 * Non-`_ref` fields are never touched.
 */
export async function processVaultRefs(
  frontmatter: Record<string, unknown>,
  vault: PiiVault,
  mode: "store" | "resolve",
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...frontmatter };

  for (const [key, value] of Object.entries(result)) {
    if (!key.endsWith("_ref") || typeof value !== "string") {
      continue;
    }

    if (mode === "store") {
      // Already a vault reference -- leave as-is
      if (value.startsWith(VAULT_PREFIX)) continue;

      // Plain string -- store in vault and replace with ref
      const entityId = extractEntityId(result);
      const fieldName = key.replace(/_ref$/, "");
      const ref = await vault.storeSecret(entityId, fieldName, value);
      result[key] = ref;
    } else {
      // resolve mode
      if (!value.startsWith(VAULT_PREFIX)) continue;

      const resolved = await vault.resolveRef(value);
      if (resolved !== null) {
        result[key] = resolved;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a usable entity ID from frontmatter.
 * Prefers `id`, falls back to `slug`, then a generic fallback.
 */
function extractEntityId(frontmatter: Record<string, unknown>): string {
  if (typeof frontmatter.id === "string" && frontmatter.id.length > 0) {
    return frontmatter.id;
  }
  if (typeof frontmatter.slug === "string" && frontmatter.slug.length > 0) {
    return frontmatter.slug;
  }
  return "unknown";
}
