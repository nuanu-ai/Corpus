# Operations

## Environment

```bash
export CORPUS_APP_URL="https://corpus.example"
export CORPUS_API_KEY="corpus_sk_..."
```

Optional:

```bash
export CORPUS_COMPANY_ID="<company-id>"
```

For `company_id`, prefer the UUID from `session.companyAccess.companies[].id`. If an agent only has a human-facing reference, the API accepts the company slug or exact company name as a fallback.

## Bootstrap

```bash
node bin/openclaw-corpus-adapter.mjs session
node bin/openclaw-corpus-adapter.mjs tools
```

## Company Discovery

```bash
node bin/openclaw-corpus-adapter.mjs companies
```

## Dashboard

```bash
node bin/openclaw-corpus-adapter.mjs dashboard \
  '{"company_id":"<company-id>"}'
```

## Query Entities

```bash
node bin/openclaw-corpus-adapter.mjs query \
  '{"company_id":"<company-id>","domain":"finance","limit":10,"view":"summary"}'
```

## Search Entities

```bash
node bin/openclaw-corpus-adapter.mjs search \
  '{"company_id":"<company-id>","query":"investor","limit":10}'
```

## Get Entity

Native ID form:

```bash
node bin/openclaw-corpus-adapter.mjs get-entity \
  '{"company_id":"<company-id>","qualified_id":"snapshot-1","view":"summary"}'
```

Domain + ID form:

```bash
node bin/openclaw-corpus-adapter.mjs get-entity \
  '{"company_id":"<company-id>","domain":"finance","id":"snapshot-1","view":"summary"}'
```

## Read Raw File

```bash
node bin/openclaw-corpus-adapter.mjs get-file \
  '{"company_id":"<company-id>","path":"finance/_summary.qmd"}'
```

## List Connectors

```bash
node bin/openclaw-corpus-adapter.mjs connectors \
  '{"company_id":"<company-id>"}'
```

## Telegram

```bash
node bin/openclaw-corpus-adapter.mjs connector \
  '{"company_id":"<company-id>","provider":"telegram","action":"list_chats","input":{"limit":25,"offset":0,"enabledOnly":true}}'
```

```bash
node bin/openclaw-corpus-adapter.mjs connector \
  '{"company_id":"<company-id>","provider":"telegram","action":"get_recent_messages","input":{"chatId":"-4930599199","limit":20,"offset":0}}'
```

## Google Drive

```bash
node bin/openclaw-corpus-adapter.mjs connector \
  '{"company_id":"<company-id>","provider":"google_drive","action":"list_files","input":{"root":"shared_with_me"}}'
```

## Documents

```bash
node bin/openclaw-corpus-adapter.mjs documents \
  '{"company_id":"<company-id>","limit":20,"status":"processing"}'
```

## Document Questions

List pending clarification questions that the document pipeline needs before final routing/review:

```bash
node bin/openclaw-corpus-adapter.mjs document-questions \
  '{"company_id":"<company-id>","limit":20}'
```

Answer questions for one document and optionally reprocess:

```bash
node bin/openclaw-corpus-adapter.mjs answer-document-questions \
  '{"company_id":"<company-id>","documentId":"<document-id>","answers":{"source":"Uploaded by external agent from Google Drive folder X","business_context":"Monthly vendor invoice batch"},"reprocess":true}'
```
