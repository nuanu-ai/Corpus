import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { storage, buildStorageKey } from "@/lib/storage";
import { db } from "@/lib/db";
import { companies, documents, rawEvents, auditLog } from "@/lib/db/schema";
import {
  buildEmailParticipants,
  deriveEmailThreadId,
  extractEmailBody,
  extractEmailMessageId,
  normalizeEmailSubject,
  parseMailbox,
  parseMailboxList,
} from "@/lib/communications/email";
import {
  findCommunicationMessageByProviderKey,
  insertCommunicationMessage,
} from "@/lib/communications/store";
import {
  validateIngestAddress,
  resolveIngestCompany,
  evaluateEmailIngestSignature,
  getEmailIngestWebhookSigningSecret,
  getSendGridInboundParsePublicKey,
  hasSendGridInboundParseSignatureHeaders,
  evaluateSenderAllowlist,
  checkRateLimit,
  isSupportedAttachmentType,
} from "@/lib/email-ingest";
import { inferFileType } from "@/lib/documents";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import { buildQueuedCodexOcrResult } from "@/lib/codex-worker/status";
import type { CodexWorkerPool } from "@/lib/codex-worker/types";
import {
  logGuardrailEvent,
  resolveGuardrailRollout,
} from "@/lib/guardrails/safe-rollout";

const EMAIL_PROVIDER = "email_ingest";
const EMAIL_CHAT_ID = "inbound-email";

function isProductionEmailIngestRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function extractRecipientAddresses(value: string): string[] {
  const list = parseMailboxList(value);
  if (list.length > 0) return list;
  const single = parseMailbox(value).address;
  return single ? [single] : [];
}

function extractEnvelopeRecipients(envelope: string): string[] {
  if (!envelope || !envelope.trim()) return [];

  try {
    const parsed = JSON.parse(envelope) as Record<string, unknown>;
    const values = [
      parsed.to,
      parsed.recipients,
      parsed.rcpt_to,
      parsed.recipient,
    ];
    const recipients: string[] = [];

    for (const value of values) {
      if (typeof value === "string") {
        recipients.push(...extractRecipientAddresses(value));
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item !== "string") continue;
          recipients.push(...extractRecipientAddresses(item));
        }
      }
    }

    return Array.from(new Set(recipients));
  } catch {
    return [];
  }
}

function resolveIngestValidation(input: {
  to: string;
  cc: string;
  bcc: string;
  envelope: string;
}) {
  const candidates = Array.from(
    new Set([
      ...parseMailboxList(input.to),
      ...parseMailboxList(input.cc),
      ...parseMailboxList(input.bcc),
      ...extractEnvelopeRecipients(input.envelope),
    ]),
  );

  for (const candidate of candidates) {
    const validation = validateIngestAddress(candidate);
    if (validation.valid) {
      return validation;
    }
  }

  return validateIngestAddress(input.to);
}

function stableDocumentId(messageId: string, attachmentIndex: number): string {
  const hex = createHash("sha1")
    .update(`${messageId}:${attachmentIndex}`)
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export async function POST(req: NextRequest) {
  try {
    const hmacSigningSecret = getEmailIngestWebhookSigningSecret();
    const sendGridPublicKey = getSendGridInboundParsePublicKey();
    const signatureConfigured = Boolean(hmacSigningSecret || sendGridPublicKey);
    const signatureHeaderPresent =
      Boolean(req.headers.get("x-corpus-email-ingest-signature")) ||
      hasSendGridInboundParseSignatureHeaders(req.headers);
    const rawBodyForSignature =
      signatureConfigured || signatureHeaderPresent
        ? Buffer.from(await req.clone().arrayBuffer())
        : Buffer.alloc(0);
    const formData = await req.formData();

    // 1. Parse fields from SendGrid Inbound Parse
    const from = (formData.get("from") as string) ?? "";
    const to = (formData.get("to") as string) ?? "";
    const subject = (formData.get("subject") as string) ?? "";
    const headers = (formData.get("headers") as string) ?? "";
    const textBody = (formData.get("text") as string) ?? "";
    const htmlBody = (formData.get("html") as string) ?? "";
    const cc = (formData.get("cc") as string) ?? "";
    const bcc = (formData.get("bcc") as string) ?? "";
    const spf = (formData.get("SPF") as string) ?? "";
    const dkim = (formData.get("dkim") as string) ?? "";
    const envelope = (formData.get("envelope") as string) ?? "";

    // 2. Extract Message-ID from headers
    const messageId = extractEmailMessageId(headers) ?? randomUUID();
    const threadId = deriveEmailThreadId(subject, headers);
    const normalizedSubject = normalizeEmailSubject(subject);
    const sender = parseMailbox(from);
    const participants = buildEmailParticipants({ from, to, cc, bcc });
    const content = extractEmailBody(textBody, htmlBody);

    // 3. Validate ingest address format
    const validation = resolveIngestValidation({ to, cc, bcc, envelope });
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 401 },
      );
    }

    // 4. Resolve company from ingest token
    const companyId = await resolveIngestCompany(validation.token!);
    if (!companyId) {
      return NextResponse.json(
        { error: "Unknown ingest address" },
        { status: 401 },
      );
    }

    const [tenant] = await db
      .select({
        tenantKind: companies.tenantKind,
        settings: companies.settings,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    const isPersonalTenant = tenant?.tenantKind === "person";
    const isCompanyTenant = !isPersonalTenant;

    const emailAuthenticityGuardrail = resolveGuardrailRollout({
      key: "email_ingest_authenticity",
      companyId,
    });
    const signatureResult = evaluateEmailIngestSignature({
      headers: req.headers,
      rawBody: rawBodyForSignature,
      secret: hmacSigningSecret,
      sendGridPublicKey,
    });
    const providerSignatureAuthenticated =
      signatureResult.authenticated &&
      signatureResult.provider === "sendgrid_inbound_parse_ecdsa";
    const providerSigningConfigured = Boolean(sendGridPublicKey);
    const providerSignatureRequired =
      isCompanyTenant && providerSigningConfigured;
    if (
      isCompanyTenant &&
      isProductionEmailIngestRuntime() &&
      !providerSigningConfigured
    ) {
      logGuardrailEvent({
        decision: emailAuthenticityGuardrail,
        action: "blocked_email_ingest_provider_signature_unconfigured",
        reason: "provider_signature_config_missing",
        details: {
          signatureStatus: signatureResult.status,
          provider: signatureResult.provider,
          hasHmacSignatureConfig: Boolean(hmacSigningSecret),
          hasProviderSignatureConfig: providerSigningConfigured,
          hasSignatureHeader: signatureHeaderPresent,
        },
      });
      return NextResponse.json(
        { error: "Email ingest provider signature verification not configured" },
        { status: 500 },
      );
    }

    const strictProviderSignatureRequired =
      providerSignatureRequired || emailAuthenticityGuardrail.shouldEnforce;
    const signatureAccepted = strictProviderSignatureRequired
      ? providerSignatureAuthenticated
      : signatureResult.authenticated;
    if (!signatureAccepted) {
      logGuardrailEvent({
        decision: emailAuthenticityGuardrail,
        action: strictProviderSignatureRequired
          ? "blocked_unsigned_email_ingest"
          : "would_block_unsigned_email_ingest",
        reason: strictProviderSignatureRequired && !providerSignatureAuthenticated
          ? "provider_signature_required"
          : signatureResult.reason,
        details: {
          signatureStatus: signatureResult.status,
          provider: signatureResult.provider,
          hasSignatureConfig: signatureConfigured,
          hasHmacSignatureConfig: Boolean(hmacSigningSecret),
          hasProviderSignatureConfig: providerSigningConfigured,
          hasSignatureHeader: signatureHeaderPresent,
          providerSignatureAuthenticated,
        },
      });

      if (strictProviderSignatureRequired) {
        return NextResponse.json(
          { error: "Email ingest webhook signature verification failed" },
          { status: 401 },
        );
      }
    }

    // SPF/DKIM fields from SendGrid's form payload are evidence metadata only.
    // Webhook authenticity is the provider signature plus tenant sender policy.

    // 5. Check sender allowlist
    const senderAllowlist = evaluateSenderAllowlist(
      from,
      companyId,
      tenant?.settings ?? null,
    );
    const senderPolicyEnforced =
      isCompanyTenant || emailAuthenticityGuardrail.shouldEnforce;
    const senderAllowed = senderAllowlist.allowed &&
      (senderAllowlist.configured || !senderPolicyEnforced);
    if (!senderAllowed) {
      logGuardrailEvent({
        decision: emailAuthenticityGuardrail,
        action: senderPolicyEnforced
          ? "blocked_email_sender"
          : "would_block_email_sender",
        reason: senderAllowlist.reason,
        details: {
          senderEmail: senderAllowlist.senderEmail,
          senderAllowlistConfigured: senderAllowlist.configured,
          matchedEntry: senderAllowlist.matchedEntry ?? null,
        },
      });
      return NextResponse.json(
        { error: "Sender not allowed" },
        { status: 403 },
      );
    }

    const existingMessage = await findCommunicationMessageByProviderKey({
      companyId,
      provider: EMAIL_PROVIDER,
      providerChatId: EMAIL_CHAT_ID,
      providerMessageId: messageId,
    });
    if (existingMessage) {
      return NextResponse.json({
        received: true,
        duplicate: true,
        attachments: 0,
        messageId,
        threadId,
      });
    }

    // 6. Rate limit check
    if (!checkRateLimit(companyId)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      );
    }

    // 7. Extract and process attachments
    let processedCount = 0;
    const attachmentRefs: Array<Record<string, unknown>> = [];
    let attachmentIndex = 0;
    let workerPoolPromise: Promise<CodexWorkerPool> | null = null;

    const getWorkerPool = () => {
      workerPoolPromise ??= resolveCompanyCodexWorkerPool(companyId);
      return workerPoolPromise;
    };

    for (const [, value] of formData.entries()) {
      if (!(value instanceof File)) continue;
      if (!isSupportedAttachmentType(value.name, value.type)) continue;

      const buffer = Buffer.from(await value.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const documentId = stableDocumentId(messageId, attachmentIndex);
      const fileType = inferFileType(value.name, value.type);
      const usePostIngressDispatch = shouldUsePostIngressDispatch({
        companyId,
        fileType,
      });

      // Upload to local storage
      const storageKey = buildStorageKey({
        companyId,
        documentId,
        sha256,
        fileName: value.name,
      });
      await storage.put(storageKey, buffer);

      // Insert into DB — orphan cleanup if inserts fail
      try {
        await db.transaction(async (tx) => {
          await tx.insert(documents).values({
            id: documentId,
            companyId,
            fileName: value.name,
            fileType,
            fileSizeBytes: value.size,
            storageUrl: storageKey,
            sha256,
            source: usePostIngressDispatch ? EMAIL_PROVIDER : "codex_upload",
            status: "processing",
            ocrResult: usePostIngressDispatch
              ? null
              : buildQueuedCodexOcrResult(undefined, await getWorkerPool()),
          }).onConflictDoNothing();

          await tx
            .insert(rawEvents)
            .values({
              companyId,
              sourceEventId: documentId,
              idempotencyKey: `email_ingest:${messageId}:${attachmentIndex}`,
              source: usePostIngressDispatch ? EMAIL_PROVIDER : "codex_upload",
              eventType: usePostIngressDispatch
                ? "email_ingest.document.received"
                : "codex.document.queued",
              rawPayload: {
                documentId,
                fileName: value.name,
                fileType,
                fileSizeBytes: value.size,
                sha256,
                storageKey,
                ingressSource: "email_ingest",
                from,
                subject,
                messageId,
                threadId,
              },
            })
            .onConflictDoNothing();

          if (usePostIngressDispatch) {
            await enqueueOutboxEvent(
              tx,
              buildDocumentIngressEvent({
                documentId,
                companyId,
                fileType,
                storageKey,
              }),
            );
          }
          const shadowEvent = buildSimplifiedNarrativeShadowEvent({
            documentId,
            companyId,
            fileType,
            storageKey,
          });
          if (shadowEvent) {
            await enqueueOutboxEvent(tx, shadowEvent);
          }
        });
      } catch (dbErr) {
        await storage.remove(storageKey).catch(() => {});
        throw dbErr;
      }

      processedCount++;
      attachmentRefs.push({
        file_name: value.name,
        file_type: fileType,
        mime_type: value.type || null,
        file_size_bytes: value.size,
        sha256,
        storage_key: storageKey,
        document_id: documentId,
      });
      attachmentIndex += 1;
    }

    await insertCommunicationMessage({
      companyId,
      provider: EMAIL_PROVIDER,
      providerMessageId: messageId,
      providerChatId: EMAIL_CHAT_ID,
      providerThreadId: threadId,
      processingStatus: isPersonalTenant ? "processed" : "pending",
      subject: normalizedSubject || subject,
      senderName: sender.name,
      senderAddress: sender.address,
      participantAddresses: participants,
      attachmentRefs,
      content,
      rawPayload: {
        from,
        to,
        cc,
        bcc,
        subject,
        headers,
        envelope,
        spf,
        dkim,
        messageId,
        threadId,
      },
      receivedAt: new Date(),
    });

    // 8. Audit log
    await db.insert(auditLog).values({
      companyId,
      action: "email_ingested",
      entityType: "email",
      newValue: {
        from,
        subject,
        messageId,
        threadId,
        attachmentCount: processedCount,
      },
    });

    // 9. Return success
    return NextResponse.json({
      received: true,
      attachments: processedCount,
      messageId,
      threadId,
    });
  } catch (err) {
    console.error("Email ingest error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
