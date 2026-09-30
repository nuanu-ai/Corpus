# Security policy

## Supported versions

Security fixes are currently applied to the latest commit on `public-beta`. No stable release line is supported yet.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, or customer data. Use GitHub's private vulnerability reporting feature for the repository. If that feature is unavailable, contact the maintainers through a private channel listed on the repository profile.

Include the affected component, reproduction conditions, impact, and any proposed mitigation. Remove real secrets and personal data from reports.

## Operational responsibility

Corpus processes sensitive company information. Self-hosting operators are responsible for secret management, database isolation, encryption keys, connector permissions, backups, network controls, dependency updates, and compliance obligations. Review `docs/security-model.md` before exposing a deployment to the internet.
