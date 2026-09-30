# Public release checklist

Use this checklist before mirroring Corpus to a public repository.

1. Run `npm ci` from a fresh checkout.
2. Run `npm run release:check` to detect legacy names, likely credentials,
   private paths, generated directories, and risky data-file extensions.
3. Run `npm audit --omit=dev --audit-level=high`.
4. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
5. Install `extraction/requirements.txt` in an isolated Python environment and
   run `python -m pytest` from `extraction/`.
6. Confirm `.env.example` contains no credentials and every real deployment
   secret is supplied out of band.
7. Confirm the public Git remote is new and the branch contains no inherited
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
