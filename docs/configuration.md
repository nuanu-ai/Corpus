# Configuration

Start from `.env.example`. The app, database commands, and service scripts read `.env.local` using Next.js environment precedence. Run commands from the repository root. Empty optional credentials disable their integration.

## Required settings

- `DATABASE_URL` — PostgreSQL connection string.
- `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` — matching application origins.
- `BETTER_AUTH_SECRET` — session-signing secret (`openssl rand -base64 32`).
- `ENCRYPTION_KEY` — 32-byte key (`openssl rand -hex 32`).
- `COMPANY_DB_INTERNAL_SERVICE_SECRET` — a separate internal-service secret (`openssl rand -base64 32`).
- `ANTHROPIC_API_KEY` — required by main chat and production startup. `OPENAI_API_KEY` is for optional integrations and does not replace it. Plain text/Markdown/HTML/DOCX ingestion and full-text search do not require an AI key.

## Local services

After building Company-DB and applying the schema, run `npm run services` and `npm run dev` in separate terminals. The services command starts:

1. The Company-DB supervisor. It discovers companies in PostgreSQL, scaffolds each store and runs its API, write queue and MCP server on loopback. It starts tenants on first knowledge access, restarts failed children and stops them on Ctrl-C. Only one supervisor may run against a database.
2. A pinned local Inngest dev server, which calls `/api/inngest` to execute the existing document-processing functions and outbox drain. Its console is at `INNGEST_BASE_URL` (default `http://127.0.0.1:8288`).

| Setting | Local default | Purpose |
| --- | --- | --- |
| `COMPANY_DB_REPO` | `./data/companies` | Parent directory of tenant stores; keep persistent |
| `STORAGE_DIR` | `./storage` | Original uploaded files; keep persistent |
| `COMPANY_DB_HOST` | `127.0.0.1` | Company-DB services on the same host |
| `COMPANY_DB_PORT_START` | `4100` | First tenant API port; queue uses +1, MCP +2 |
| `COMPANY_DB_PORT_STRIDE` | `10` | Space between tenants' port blocks |
| `COMPANY_DB_AUTO_PROVISION` | `true` | Allow the supervisor to scaffold stores |
| `CORPUS_DOCUMENT_PROCESSOR` | `inngest` in the example | Dispatch standard uploads to Inngest handlers |
| `INNGEST_DEV` | `1` | Local Inngest mode; remove for production |
| `CORPUS_DEMO_MODE` | `false` | Require normal authentication |

The supervisor is intended for a single host with local storage, not a distributed process manager. It marks a tenant active only after readiness reports the correct tenant identity. Uploads return 503 without saving a document if that service is unavailable. `/api/health` checks PostgreSQL and actual tenant services; `companyDb: idle` means no tenant service has been requested yet. Unused community tenants stay pending until their first knowledge query, upload, or chat.

The transactional outbox drains once per minute. An accepted upload is still `processing`; only a completed document with indexed source references proves ingestion. Optional PDF/OCR/financial parsing needs its corresponding extraction providers. Existing Codex-worker routing remains available when `CORPUS_DOCUMENT_PROCESSOR` is unset; it requires a separately configured Codex worker and is not the quick-start path.

## Production

Use TLS, a dedicated database role, persistent storage, backups, an explicit trusted-origin allowlist, and unique secrets supplied out of band. Keep demo mode disabled.

Run `npm run services:company-db` under a process manager, from the application directory with Node 22 and installed runtime tooling. Run the built web application with `NODE_ENV=production npm run start`. Configure a durable Inngest deployment with `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, and its `INNGEST_BASE_URL` if self-hosting; remove `INNGEST_DEV`. The `npm run services` wrapper deliberately refuses production mode. The Inngest server is a separately licensed dependency; its source and deployment instructions are linked from the `inngest-cli` package.

If another process manager owns Company-DB, disable auto provisioning and ensure it serves the assigned tenant ports with the matching slug and shared service-auth configuration. Do not run two managers for the same stores. Rebuild and restart Company-DB alongside the web application when upgrading; readiness requires its tenant-aware health response.

Connector credentials are optional and should receive the narrowest possible scopes. This setup does not attest live connectors, model responses, backups, or a production deployment.

## Dependency overrides

The lockfile updates vulnerable transitive packages without upgrading the main authentication/AI frameworks. Scoped overrides keep the old Drizzle loader on patched esbuild 0.25.12, tsup on esbuild 0.28.2, and the Inngest CLI archive installer on adm-zip 0.6.1. Database loading, Company-DB builds, and the real local service startup are covered by checks. Remove an override when its parent dependency adopts a patched version.
