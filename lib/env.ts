/**
 * Environment variable validation.
 *
 * Import this module early (e.g. in next.config.ts or instrumentation.ts)
 * to fail fast in production when critical variables are missing.
 */

interface EnvVar {
  name: string;
  critical: boolean; // true = fail in production, false = warn only
  description: string;
}

interface EnvRequirementGroup {
  names: string[];
  critical: boolean;
  description: string;
}

const REQUIRED_VARS: EnvVar[] = [
  {
    name: "DATABASE_URL",
    critical: true,
    description: "PostgreSQL connection string",
  },
  {
    name: "BETTER_AUTH_SECRET",
    critical: true,
    description: "Secret for Better Auth session signing",
  },
  {
    name: "ANTHROPIC_API_KEY",
    critical: true,
    description: "Anthropic API key for Claude AI",
  },
  {
    name: "ENCRYPTION_KEY",
    critical: true,
    description: "Key for encrypting connection credentials",
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    critical: false,
    description: "Public app URL for OAuth callbacks",
  },
];

const REQUIRED_GROUPS: EnvRequirementGroup[] = [
  {
    names: [
      "COMPANY_DB_INTERNAL_SERVICE_SECRET",
      "COMPANY_DB_INTERNAL_SERVICE_SECRETS",
    ],
    critical: true,
    description:
      "Company-DB internal auth must be configured via signed internal-service secret(s)",
  },
];

export function validateEnv(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProd = process.env.NODE_ENV === "production";

  for (const v of REQUIRED_VARS) {
    if (!process.env[v.name]) {
      const msg = `Missing env var: ${v.name} — ${v.description}`;
      if (v.critical) {
        if (isProd) {
          errors.push(msg);
        } else {
          warnings.push(msg);
        }
      } else {
        warnings.push(msg);
      }
    }
  }

  if (isProd && process.env.CORPUS_DEMO_MODE === "true") {
    errors.push(
      "CORPUS_DEMO_MODE=true is not allowed in production. Demo mode would bypass auth.",
    );
  }

  const inngestDev = process.env.INNGEST_DEV?.trim().toLowerCase();
  if (isProd && inngestDev && !["0", "false"].includes(inngestDev)) {
    errors.push("INNGEST_DEV must be unset in production; configure authenticated Inngest instead.");
  }
  const processor = process.env.CORPUS_DOCUMENT_PROCESSOR;
  if (processor && !["inngest", "codex"].includes(processor)) {
    errors.push("CORPUS_DOCUMENT_PROCESSOR must be inngest or codex.");
  }

  for (const group of REQUIRED_GROUPS) {
    const hasAnyValue = group.names.some((name) => {
      const value = process.env[name];
      return typeof value === "string" && value.trim().length > 0;
    });
    if (hasAnyValue) continue;

    const msg =
      `Missing one of env vars: ${group.names.join(" | ")} — ${group.description}`;
    if (group.critical) {
      if (isProd) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    } else {
      warnings.push(msg);
    }
  }

  // Check that no server secrets are accidentally exposed via NEXT_PUBLIC_
  const dangerousPublicVars = Object.keys(process.env).filter(
    (key) =>
      key.startsWith("NEXT_PUBLIC_") &&
      (key.includes("SECRET") ||
        key.includes("PASSWORD") ||
        key.includes("ENCRYPTION") ||
        key.includes("PRIVATE_KEY"))
  );

  for (const key of dangerousPublicVars) {
    errors.push(
      `SECURITY: ${key} is exposed to the client bundle via NEXT_PUBLIC_ prefix. ` +
        `Remove the NEXT_PUBLIC_ prefix or rename the variable.`
    );
  }

  // Production URL sanity checks (prevents auth/OAuth misrouting to localhost).
  if (isProd) {
    const urlVars = ["NEXT_PUBLIC_APP_URL", "BETTER_AUTH_URL"] as const;
    for (const key of urlVars) {
      const value = process.env[key];
      if (!value) continue;
      try {
        const parsed = new URL(value);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === "localhost" || hostname === "127.0.0.1") {
          errors.push(
            `${key} points to localhost in production (${value}). ` +
              `Set it to your public HTTPS domain.`,
          );
        }
      } catch {
        errors.push(`${key} is not a valid URL: ${value}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Run validation and log results. Call this at startup.
 * In production, throws if critical vars are missing.
 */
export function checkEnv(): void {
  const { valid, errors, warnings } = validateEnv();
  const isProd = process.env.NODE_ENV === "production";

  if (warnings.length > 0) {
    console.warn(
      `\n[env] ${warnings.length} warning(s):\n` +
        warnings.map((w) => `  - ${w}`).join("\n") +
        "\n"
    );
  }

  if (!valid) {
    const message =
      `[env] ${errors.length} critical error(s):\n` +
      errors.map((e) => `  - ${e}`).join("\n");

    if (isProd) {
      throw new Error(message);
    } else {
      console.error(`\n${message}\n`);
    }
  }
}
