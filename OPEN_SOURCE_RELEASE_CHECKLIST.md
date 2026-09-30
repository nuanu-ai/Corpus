# Corpus open-source release checklist

This repository is a clean public export. It does not contain the Git history,
remotes, private archives, customer documents, or deployment state of the
internal project from which it originated.

## Completed for the initial public export

- [x] Rename the product and package namespace to Corpus.
- [x] Start from an allowlisted source export instead of copying the full tree.
- [x] Remove internal archives, customer-derived fixtures, personal paths, and
      organization-specific operating rules.
- [x] Replace the historical test corpus with a small synthetic test suite.
- [x] Remove the direct GPL-only Telegram client dependency; retain the Bot API
      path and an adapter boundary for optional MTProto integrations.
- [x] Add an Apache-2.0 license, contribution guide, code of conduct, security
      policy, example environment, architecture notes, and CI workflow.
- [x] Verify lint, TypeScript, tests, dependency audit, and production build.
- [x] Create a new Git repository with no inherited commits or remotes.

## Before making the GitHub repository public

- [ ] Create an empty repository named `Corpus` in the intended GitHub
      organization and push the local `public-beta` branch.
- [ ] Confirm that the publishing organization owns or has permission to
      release every included source file and asset, and approve Apache-2.0 as
      the project license.
- [ ] Confirm the `Corpus` name, logo, domains, and package namespace are clear
      for public use.
- [ ] Configure branch protection and require the CI workflow on `public-beta`.
- [ ] Enable Dependabot alerts, secret scanning, push protection, and private
      vulnerability reporting where the GitHub plan supports them.
- [ ] Add repository topics, a short description, social preview, and public
      support/contact links.
- [ ] Review the remaining moderate dependency advisories, including
      transitive database and build tooling when upstream-compatible updates are available.
- [ ] Replace the reduced synthetic test baseline with broader public fixtures
      before declaring a stable release.
- [ ] Tag `v0.1.0` only after a clean CI run from the public GitHub repository.

## Release rule

Never copy files or Git objects from the internal clone into this repository
without repeating the data, secret, dependency, and license review.
