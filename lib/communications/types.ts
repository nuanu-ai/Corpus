import { z } from "zod";

export const COMMUNICATION_AUTO_DOMAINS = ["communications", "people"] as const;
export const COMMUNICATION_ROUTABLE_DOMAINS = [
  "communications",
  "people",
  "finance",
  "banking",
  "revenue",
  "expenses",
  "legal",
  "governance",
  "tax",
  "operations",
  "assets",
  "documents",
] as const;

export type CommunicationAutoDomain = (typeof COMMUNICATION_AUTO_DOMAINS)[number];
export type CommunicationTargetDomain = (typeof COMMUNICATION_ROUTABLE_DOMAINS)[number];

export const communicationAmountSchema = z.object({
  value: z.number(),
  currency: z.string().trim().toUpperCase().max(12).optional(),
  unit: z.string().trim().max(32).optional(),
  context: z.string().trim().max(160).optional(),
});

export const communicationDateSchema = z.object({
  date: z.string().trim().min(4).max(40),
  meaning: z.string().trim().min(1).max(80),
});

export const communicationSignalSchema = z.object({
  type: z.enum([
    "commitment",
    "decision",
    "request",
    "information",
    "risk",
    "deadline",
    "contact",
    "organization",
  ]),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(8).max(2000),
  targetDomain: z.enum(COMMUNICATION_ROUTABLE_DOMAINS),
  participants: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  counterparties: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  keyThemes: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  risks: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  amounts: z.array(communicationAmountSchema).max(12).default([]),
  dates: z.array(communicationDateSchema).max(12).default([]),
  sourceMessageIds: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  confidence: z.number().min(0).max(1),
});

export const communicationContactSchema = z.object({
  name: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["employee", "client", "partner", "vendor", "contractor", "other"]),
  organizationName: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).optional(),
  telegramHandle: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(600).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  sourceMessageIds: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  confidence: z.number().min(0).max(1),
});

export const communicationOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  role: z.enum(["vendor", "client", "partner", "government", "bank", "other"]),
  domains: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  notes: z.string().trim().max(600).optional(),
  sourceMessageIds: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  confidence: z.number().min(0).max(1),
});

export const communicationThreadContextSchema = z.object({
  topic: z.string().trim().min(3).max(160),
  status: z.enum(["active", "waiting_for_response", "blocked", "completed", "monitoring"]),
  lastContext: z.string().trim().min(3).max(1200),
  participants: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  startedMessageId: z.string().trim().min(1).max(120).optional(),
});

export const communicationsSynthesisSchema = z.object({
  language: z.string().trim().min(2).max(32).default("en"),
  dailySummary: z.string().trim().min(8).max(4000),
  signals: z.array(communicationSignalSchema).max(30).default([]),
  contacts: z.array(communicationContactSchema).max(20).default([]),
  organizations: z.array(communicationOrganizationSchema).max(20).default([]),
  ongoingThreads: z.array(communicationThreadContextSchema).max(10).default([]),
});

export type CommunicationAmount = z.infer<typeof communicationAmountSchema>;
export type CommunicationDate = z.infer<typeof communicationDateSchema>;
export type CommunicationSignal = z.infer<typeof communicationSignalSchema>;
export type CommunicationContact = z.infer<typeof communicationContactSchema>;
export type CommunicationOrganization = z.infer<typeof communicationOrganizationSchema>;
export type CommunicationThreadContext = z.infer<typeof communicationThreadContextSchema>;
export type CommunicationsSynthesis = z.infer<typeof communicationsSynthesisSchema>;

export interface CommunicationBatch {
  companyId: string;
  companySlug: string;
  companyDbPort: number;
  provider: string;
  providerChatId: string;
  providerThreadId: string;
  dayKey: string;
}

export interface CommunicationMessageRow {
  id: string;
  providerMessageId: string;
  providerThreadId: string;
  providerChatId: string;
  provider: string;
  subject: string | null;
  senderName: string | null;
  senderAddress: string | null;
  senderId: string | null;
  participantAddresses: string[];
  attachmentRefs: Array<Record<string, unknown>>;
  content: string | null;
  rawPayload: Record<string, unknown>;
  receivedAt: string;
}

export interface BuiltCommunicationFile {
  path: string;
  content: string;
}

export function requiresSignalApproval(domain: string): boolean {
  return !COMMUNICATION_AUTO_DOMAINS.includes(domain as CommunicationAutoDomain);
}
