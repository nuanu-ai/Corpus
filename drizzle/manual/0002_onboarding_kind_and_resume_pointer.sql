-- Migration: chat-first onboarding additive schema (feat/chat-onboarding)
--
-- 1. users.current_onboarding_thread_id — resume pointer for in-flight
--    onboarding threads. NULL when user is not mid-onboarding. Lets a
--    second tab / device pick up the same conversation instead of starting
--    cold. Cleared after onboarding_complete_and_handoff.
--
-- 2. chat_threads.kind — first-class thread kind, SQL-filterable. NULL =
--    ordinary chat. Set to 'onboarding' for chat-first onboarding threads
--    so the chat runtime and audit queries can branch without parsing
--    jsonb. Per the v6.3.0 architecture-review pack (Architect §10 +
--    Forge H3).
--
-- Both columns are nullable, additive, zero-default — safe on a populated
-- production table. No backfill required. No constraints. No indexes
-- (the columns are used by point-lookups keyed on the existing primary
-- keys; if `kind` becomes a frequent filter we can add a partial index
-- WHERE kind IS NOT NULL later).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "current_onboarding_thread_id" uuid;

ALTER TABLE "chat_threads"
  ADD COLUMN IF NOT EXISTS "kind" text;
