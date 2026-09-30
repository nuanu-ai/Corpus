import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";

// PROD SAFETY: INNGEST_SIGNING_KEY presence must be human-verified before every
// production deploy. Without it, Inngest webhook requests are not cryptographically
// verified and any caller can trigger background functions.
if (process.env.NODE_ENV === "production" && !process.env.INNGEST_SIGNING_KEY) {
  throw new Error(
    "[inngest] INNGEST_SIGNING_KEY is not set — refusing to start in production without a signing key",
  );
}
import {
  stripeSync,
  stripeDailySync,
} from "@/lib/inngest/functions/stripe-sync";
import { processDocument } from "@/lib/inngest/functions/process-document";
import {
  plaidTransactionSync,
  plaidReconciliationPoll,
} from "@/lib/inngest/functions/plaid-sync";
import {
  truelayerTransactionSync,
  truelayerReconciliationPoll,
} from "@/lib/inngest/functions/truelayer-sync";
import {
  mercuryTransactionSync,
  mercuryReconciliationPoll,
} from "@/lib/inngest/functions/mercury-sync";
import {
  paypalTransactionSync,
  paypalReconciliationPoll,
} from "@/lib/inngest/functions/paypal-sync";
import {
  shopifyTransactionSync,
  shopifyReconciliationPoll,
} from "@/lib/inngest/functions/shopify-sync";
import {
  rutterTransactionSync,
  rutterReconciliationPoll,
} from "@/lib/inngest/functions/rutter-sync";
import { adSpendDailySync, adSpendSync } from "@/lib/inngest/functions/ad-sync";
import { normalizeRawEventFn } from "@/lib/inngest/functions/normalize-event";
import { fetchFxRatesCron } from "@/lib/inngest/functions/fetch-fx-rates";
import { syncHealthCheck } from "@/lib/inngest/functions/sync-health-check";
import { notificationEscalation } from "@/lib/inngest/functions/notification-escalation";
import { processKnowledgeDoc } from "@/lib/inngest/functions/process-knowledge-doc";
import { processSimplifiedNarrativeDocument } from "@/lib/inngest/functions/process-simplified-narrative-document";
import { shadowSimplifiedNarrativeDocument } from "@/lib/inngest/functions/shadow-simplified-narrative-document";
import { dispatchDocumentProcessing } from "@/lib/inngest/functions/dispatch-document-processing";
import { downloadGdriveFile } from "@/lib/inngest/functions/download-gdrive-file";
import {
  googleDriveWatchedFolderPoll,
  googleDriveWatchedFolderSync,
} from "@/lib/inngest/functions/sync-google-drive";
import {
  odooTransactionSync,
  odooReconciliationPoll,
} from "@/lib/inngest/functions/odoo-sync";
import { agentHealthCheck } from "@/lib/inngest/functions/agent-health";
import {
  communicationsSynthesisRequested,
  dailyCommunicationsSynthesis,
} from "@/lib/inngest/functions/daily-communications-synthesis";
import { communicationsCommitmentEscalation } from "@/lib/inngest/functions/communications-commitment-escalation";
import {
  telegramReconciliationPoll,
  telegramSync,
} from "@/lib/inngest/functions/sync-telegram";
import { executeReportJobFn } from "@/lib/inngest/functions/execute-report-job";
import { drainOutboxCron, reapOutboxCron } from "@/lib/inngest/functions/drain-outbox";
import {
  processTelegramBotUpdateFn,
  rescheduleQueuedTelegramBotUpdatesCron,
} from "@/lib/inngest/functions/process-telegram-bot-updates";
import { runLegalWatchFn } from "@/lib/inngest/functions/run-legal-watch";
import { runReportAutomationFn } from "@/lib/inngest/functions/run-report-automation";
import {
  routineSchedulerCron,
  routineStaleRunReaperCron,
} from "@/lib/inngest/functions/routine-scheduler";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    stripeSync,
    stripeDailySync,
    processDocument,
    downloadGdriveFile,
    googleDriveWatchedFolderSync,
    googleDriveWatchedFolderPoll,
    plaidTransactionSync,
    plaidReconciliationPoll,
    truelayerTransactionSync,
    truelayerReconciliationPoll,
    mercuryTransactionSync,
    mercuryReconciliationPoll,
    paypalTransactionSync,
    paypalReconciliationPoll,
    shopifyTransactionSync,
    shopifyReconciliationPoll,
    rutterTransactionSync,
    rutterReconciliationPoll,
    adSpendDailySync,
    adSpendSync,
    normalizeRawEventFn,
    fetchFxRatesCron,
    syncHealthCheck,
    agentHealthCheck,
    notificationEscalation,
    dispatchDocumentProcessing,
    processKnowledgeDoc,
    processSimplifiedNarrativeDocument,
    shadowSimplifiedNarrativeDocument,
    odooTransactionSync,
    odooReconciliationPoll,
    dailyCommunicationsSynthesis,
    communicationsSynthesisRequested,
    communicationsCommitmentEscalation,
    telegramSync,
    telegramReconciliationPoll,
    processTelegramBotUpdateFn,
    rescheduleQueuedTelegramBotUpdatesCron,
    runLegalWatchFn,
    runReportAutomationFn,
    routineSchedulerCron,
    routineStaleRunReaperCron,
    executeReportJobFn,
    drainOutboxCron,
    reapOutboxCron,
  ],
});
