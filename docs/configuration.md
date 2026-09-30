# Configuration

Start from `.env.example`. Empty optional values disable the corresponding integration.

## Required settings

- `DATABASE_URL` — PostgreSQL connection string
- `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` — canonical application URL
- `BETTER_AUTH_SECRET` — authentication secret
- `ENCRYPTION_KEY` — 32-byte key encoded as 64 hexadecimal characters
- `COMPANY_DB_INTERNAL_SERVICE_SECRET` — secret used for authenticated internal service calls

At least one supported model-provider key is required for chat features.

## Production notes

Use a managed secret store, TLS, a dedicated database role, private worker networking, and unique secrets per environment. Never reuse the example database password outside local development. Set `TRUSTED_ORIGINS` explicitly and keep demo mode disabled in production.

Connector credentials are optional and should receive the narrowest possible scopes. Rotate a credential immediately if it appears in logs or version control.
