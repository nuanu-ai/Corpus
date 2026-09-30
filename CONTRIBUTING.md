# Contributing to Corpus

Thank you for helping improve Corpus.

## Development workflow

1. Open an issue for substantial behavior or architecture changes.
2. Create a focused branch from `public-beta`.
3. Keep tenant isolation, connector scopes, and approval gates intact.
4. Add tests using synthetic data only.
5. Run `npm run typecheck`, `npm test`, and `npm run build` before opening a pull request.

## Data and privacy rules

Never commit customer documents, exports, production logs, credentials, access tokens, real email addresses, private hostnames, database dumps, or local absolute paths. Fixtures must use reserved domains such as `example.com` and clearly synthetic organizations.

Do not weaken authentication, cross-tenant access checks, connector allowlists, or human approval requirements to make a test pass.

## Pull requests

Describe the user-visible outcome, security implications, migrations, and verification performed. Keep unrelated refactors separate. Changes to database schemas or Company-DB formats must include migration or compatibility notes.

By contributing, you agree that your contribution is licensed under Apache-2.0.
