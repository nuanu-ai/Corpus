# Agent context layer

The agent context layer compiles a bounded, company-scoped context pack for an
authenticated session or API key. It combines identity, access policy, company
metadata, connector availability, and provenance without granting additional
permissions.

## Source map

Every compiled section records whether it came from application metadata,
Company-DB, a connector, or a built-in public policy. Missing sources remain
explicitly unavailable and are not replaced with guesses.

## Must not do

- Do not expand company scope beyond the authenticated membership or key.
- Do not turn linked-company metadata into implicit data access.
- Do not expose connector credentials or internal service secrets.
- Do not describe inferred information as verified source data.

## Recommended workflow

Resolve identity and company scope first, compile the context pack, select the
smallest tool surface needed for the request, retrieve evidence, and preserve
provenance in the answer or artifact.
