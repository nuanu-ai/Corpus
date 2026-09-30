# Security model

Corpus assumes company data is sensitive and tenant boundaries are mandatory.

## Invariants

- Every company-data operation is resolved against authenticated membership or a scoped API key.
- A relationship between organizations does not automatically grant data access.
- Connector calls are allowlisted and read-only unless a separate approval path authorizes an action.
- Credentials are encrypted at rest and never returned through ordinary API responses.
- Agent outputs cite retrieved evidence and must not turn missing or partial data into invented facts.
- Human approval remains required for consequential exports or actions configured as approval-gated.

## Deployment checklist

- Generate unique secrets and store them outside the repository.
- Restrict PostgreSQL and Company-DB network access.
- Use HTTPS and an explicit trusted-origin allowlist.
- Review connector OAuth scopes and webhook signatures.
- Enable backups, retention controls, audit logging, and dependency monitoring.
- Run secret scanning and `npm audit --omit=dev` in CI.
- Verify deletion and export behavior against applicable privacy requirements.

The bundled organization and data are synthetic and are not intended as production seed data.
