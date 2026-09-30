# Architecture

Corpus separates application metadata from indexed company knowledge.

The Next.js app provides authentication, user interfaces, API routes, workflow planning, and connector orchestration. PostgreSQL stores users, companies, permissions, connection metadata, jobs, and document state. Company-DB maintains per-company indexed knowledge with provenance and exposes bounded query surfaces. The optional Python extraction service converts uploaded documents into structured events before indexing.

## Main flow

1. A user uploads a document or authorizes a connector.
2. Corpus records the source under an authenticated company scope.
3. Extraction and ingestion produce structured records with provenance.
4. Company-DB indexes the records inside that company's isolated store.
5. Agent tools resolve the active company and permitted scopes before retrieval.
6. Answers and artifacts retain source references; consequential actions require approval.

## Trust boundaries

- Browser to Next.js application
- Next.js application to PostgreSQL
- Application to each Company-DB tenant service
- Application to external connectors and model providers
- Background workers to queues and storage

Do not bypass these boundaries with direct cross-tenant queries or unscoped connector calls.
