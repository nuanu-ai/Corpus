# Document pipeline stability

The document pipeline separates durable state from retryable work so uploads
can be resumed without duplicating indexed records.

## Tier A1: explicit processing stages

Each document records its current processing stage and terminal outcome. Stage
transitions are monotonic unless a user explicitly requests reprocessing.

## Tier A3: durable dispatch

Background work is dispatched through a durable outbox. A database transaction
stores both the document change and the work request before a worker attempts
delivery.

## Tier A4: schema compatibility

Readers tolerate fields written by the immediately preceding public schema
where practical. Deprecated fields are not authoritative and should be removed
only with a migration and a rollback plan.

Workers must remain idempotent, record provenance, and make partial or failed
extraction visible rather than silently promoting incomplete data.
