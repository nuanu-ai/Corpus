---
name: openclaw-corpus-agent
description: Use when OpenClaw needs to access CORPUS through one bearer API key. Covers agent-session introspection, company selection, app-level MCP usage, connector actions, Company-DB entity/file reads, and the local `bin/openclaw-corpus-adapter.mjs` bridge.
metadata: {"openclaw":{"skillKey":"openclaw-corpus-agent","homepage":"https://corpus.example","primaryEnv":"CORPUS_API_KEY","emoji":"briefcase","requires":{"env":["CORPUS_API_KEY"],"anyBins":["node"]}}}
---

# OpenClaw CORPUS Agent

## Overview

Use this skill to connect OpenClaw to the CORPUS platform without touching browser-only routes or tenant-local daemons.

Primary surfaces:

- `GET /api/agent/session`
- `GET /api/agent/companies`
- `GET /api/agent/dashboard`
- `GET|POST /api/agent/connectors`
- `GET /api/company/query`
- `GET /api/company/search`
- `GET /api/company/entity`
- `GET /api/company/file`
- `GET /api/documents`
- `GET /api/documents/questions`
- `POST /api/documents/:id/clarifications`

Project references:

- `README.md`
- `docs/architecture.md`
- `docs/security-model.md`

## Quick Start

1. Introspect the key:
   - `node bin/openclaw-corpus-adapter.mjs session`
2. List available tools:
   - `node bin/openclaw-corpus-adapter.mjs tools`
3. Resolve company scope:
   - use `implicitCompanyId` if present
   - otherwise choose a company from `companyAccess.companies`
   - pass the company UUID when available; the API also accepts slug or exact company name as `company_id`
4. Run business operations through the adapter:
   - dashboard
   - query/search
   - get-entity
   - get-file
   - connector
   - documents
   - document-questions
   - answer-document-questions

## Workflow

### 1. Bootstrap

Always start with `session`.

Read:

- granted scopes
- `implicitCompanyId`
- `requiresCompanySelection`
- accessible companies

If there is no implicit company, require OpenClaw to pass `company_id` on every operation. Prefer the UUID from `companyAccess.companies[].id`; slug or exact company name are accepted as fallbacks.

### 2. Prefer the published adapter

Use `bin/openclaw-corpus-adapter.mjs` as the primary OpenClaw bridge.

It is intentionally REST-first so the published skill does not depend on local npm packages or preinstalled MCP SDK modules.

Do not use `/api/company/mcp` as the primary integration path for OpenClaw.

### 3. Use REST only when it is simpler

REST is acceptable for:

- `/api/agent/session`
- `/api/agent/connectors` if a client wants plain JSON instead of MCP

Do not use browser onboarding routes under `/api/connections/*`.

## Common Operations

Load `references/operations.md` when you need concrete command envelopes.

Typical adapter calls:

- `session`
- `tools`
- `companies`
- `dashboard`
- `query`
- `search`
- `get-entity`
- `get-file`
- `connectors`
- `connector`
- `documents`
- `document-questions`
- `answer-document-questions`

The published skill package is self-contained and should run on a machine that only has Node and the installed skill files.

## Guardrails

- Treat `/api/agent/connectors` as the canonical machine connector surface.
- Treat `/api/connectors/hub` as legacy Slack/Jira compatibility only.
- Prefer `company_id` from session introspection instead of guessing. Use slug or exact company name only when the UUID is not available.
- If a key lacks `documents.write`, do not trigger Google Drive imports or document deletes.
- If a key uploads or imports documents, check `document-questions` before assuming processing is complete.
- Answer clarification requests with `answer-document-questions` and include provenance/source notes when available.
- If a key lacks a connector-use scope, do not attempt that provider action.
- Do not assume browser-managed integrations can be onboarded by OpenClaw.

## Validation

Before relying on the integration:

1. run `node bin/openclaw-corpus-adapter.mjs session`
2. run `node bin/openclaw-corpus-adapter.mjs tools`
3. run one read operation against a real company:
   - `dashboard`
   - or `query`
4. if connector access is needed, run one bounded action such as:
   - `telegram list_chats`
   - `google_drive list_files`
