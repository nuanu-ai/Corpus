# Public release checklist

Use this checklist before mirroring Corpus to a public repository.

1. Run `npm ci` from a fresh checkout.
2. Run `npm run release:check` to detect legacy names, likely credentials,
   private paths, generated directories, and risky data-file extensions.
3. Run `npm audit --audit-level=low` (including development tools).
4. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
5. Run `npm run test:smoke` with `CORPUS_SMOKE_DATABASE_URL` pointing to an
   empty disposable local PostgreSQL database. This starts real tenant services
   and workers; never point it at an existing deployment.
6. Install `extraction/requirements.txt` in an isolated Python environment and
   run `python -m pytest` from `extraction/`.
7. Confirm `.env.example` contains no credentials and every real deployment
   secret is supplied out of band.
8. Confirm the public Git remote is new and the branch contains no inherited
   history or unreachable objects from a private repository.

Do not weaken the release check to accommodate customer exports or internal
artifacts. Replace such files with explicitly synthetic fixtures instead.

## Public beta snapshot — 2026-09-30

The initial public upload preserves the source export and Apache-2.0 license.
Presentation, contributor forms, and the CI branch were adapted for this repository.
The lockfile updates only `glob`'s nested `brace-expansion` from 2.1.4 to 2.1.7
to resolve the high-severity advisory reported during publication.

The production dependency audit reports no high or critical findings and seven
moderate findings (including transitive entries for esbuild, fast-uri, and
ip-address). These remain open; the audit is not a full security assessment.
The synthetic test baseline and configured connectors do not establish
production readiness or verify a live company-data workflow.

## Self-hosted follow-up — 2026-10-01

The follow-up repairs env loading, starts the missing local services, dispatches
uploads to existing Inngest handlers, and rejects invalid company selectors.
The smoke test exercises real PostgreSQL, Company-DB, Inngest, authenticated
HTTP requests, document indexing, source references, and service restart.

The updated lockfile and scoped overrides report zero npm audit findings as of
2026-10-01, including development dependencies. This supersedes the initial
snapshot above; it is not a full security assessment or a production attestation.
Live AI calls, provider connectors, and PDF/OCR quality remain separate checks.
