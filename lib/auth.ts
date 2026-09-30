import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, mcp } from "better-auth/plugins";
import { db } from "./db";
import * as schema from "./db/schema";
import { allocateNextCompanyDbPort, ensureCompanyProvisioned } from "@/lib/company-db/provisioning";
import { collectTrustedOriginsFromEnv } from "./embed-config";
import { ensurePersonalProjectForUser } from "@/lib/personal-projects";

function resolveAuthBaseUrl(): string {
  const rawBaseUrl =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  try {
    const url = new URL(rawBaseUrl);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/api/auth";
    } else if (!url.pathname.endsWith("/api/auth")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/api/auth`;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    const trimmed = rawBaseUrl.replace(/\/$/, "");
    return trimmed.endsWith("/api/auth") ? trimmed : `${trimmed}/api/auth`;
  }
}

export const auth = betterAuth({
  baseURL: resolveAuthBaseUrl(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      oauthApplication: schema.oauthApplications,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthConsent: schema.oauthConsents,
      jwks: schema.jwks,
    },
  }),
  trustedOrigins: collectTrustedOriginsFromEnv(),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      // Set by the invite-code gate wrapper at /api/auth/[...all]/route.ts.
      // Existing users default to 'managed' via the column default; new sign-ups
      // inherit the tier from the consumed invite code.
      tier: {
        type: "string",
        required: false,
        defaultValue: "managed",
        input: true,
      },
    },
  },
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwks: {
        jwksPath: "/mcp/jwks",
        keyPairConfig: {
          alg: "RS256",
          modulusLength: 2048,
        },
      },
    }),
    mcp({
      loginPage: "/login",
      oidcConfig: {
        loginPage: "/login",
        allowDynamicClientRegistration: true,
        useJWTPlugin: true,
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const companyName = `${user.name}'s Company`;
          // Managed accounts wait for startup; community accounts request their
          // service lazily on first knowledge access.
          const tier = (user as { tier?: string }).tier ?? "managed";
          const lazy = tier === "community";

          // Create company + membership atomically and allocate a unique Company-DB port.
          const { companyId, companyDbPort } = await db.transaction(async (tx) => {
            const companyDbPort = await allocateNextCompanyDbPort(tx);

            const [company] = await tx
              .insert(schema.companies)
              .values({
                name: companyName,
                companyDbPort,
                provisioningStatus: "pending",
              })
              .returning({ id: schema.companies.id });

            await tx.insert(schema.companyMembers).values({
              companyId: company.id,
              userId: user.id,
              role: "owner",
            });

            return { companyId: company.id, companyDbPort };
          });

          if (lazy) {
            console.info(
              `[company-db] tier=community — skipping eager provisioning for companyId=${companyId} port=${companyDbPort}; supervisor will start it on first knowledge access`,
            );
          } else {
            // Wait for the supervisor to make the tenant service ready.
            // Keep signup resilient: user account is created even if filesystem bootstrap fails.
            try {
              await ensureCompanyProvisioned(companyId);
            } catch (error) {
              console.error(
                `[company-db] Provisioning failed for companyId=${companyId}:`,
                error,
              );
            }
          }

          try {
            const personalProject = await ensurePersonalProjectForUser({
              userId: user.id,
              name: user.name,
              email: user.email,
              skipProvisioning: lazy,
            });
            console.info(
              `[personal-project] ${lazy ? "Created (lazy)" : "Ensured"} personal tenant id=${personalProject.id} port=${personalProject.companyDbPort}`,
            );
          } catch (error) {
            console.error(
              `[personal-project] Provisioning failed for userId=${user.id}:`,
              error,
            );
          }
        },
      },
    },
  },
});
