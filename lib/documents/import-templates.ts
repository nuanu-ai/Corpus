import { randomUUID } from "crypto";

import { coerceCompanySettings, type CompanySettings } from "@/lib/company-settings";
import type {
  ClarificationAnswerMap,
  ClarificationQuestionKey,
  PromptTemplateHint,
} from "@/lib/documents/clarifications";

export interface DocumentImportTemplate extends PromptTemplateHint {
  id: string;
}

const MAX_TEMPLATES = 50;

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAnswers(
  value: unknown,
): Partial<Record<ClarificationQuestionKey, string>> {
  if (!isRecord(value)) return {};

  const next: Partial<Record<ClarificationQuestionKey, string>> = {};
  for (const key of [
    "currency",
    "entity",
    "book",
    "report_type",
    "target_domain",
    "period_label",
  ] as const) {
    const normalized = normalizeString(value[key]);
    if (normalized) {
      next[key] = normalized;
    }
  }
  return next;
}

function normalizeTemplate(value: unknown): DocumentImportTemplate | null {
  if (!isRecord(value)) return null;
  const id = normalizeString(value.id);
  if (!id) return null;
  return {
    id,
    provider: normalizeString(value.provider),
    sourceFolder: normalizeString(value.sourceFolder),
    documentKind: normalizeString(value.documentKind),
    reportType: normalizeString(value.reportType),
    answers: normalizeAnswers(value.answers),
    createdAt: normalizeString(value.createdAt),
    updatedAt: normalizeString(value.updatedAt),
  };
}

export function getDocumentImportTemplates(
  settings: unknown,
): DocumentImportTemplate[] {
  const companySettings = coerceCompanySettings(settings);
  const raw = companySettings.documentImportTemplates;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeTemplate(entry))
    .filter((entry): entry is DocumentImportTemplate => entry !== null);
}

export function withUpsertedDocumentImportTemplate(
  settings: unknown,
  input: {
    provider: string | null;
    sourceFolder: string | null;
    documentKind: string | null;
    reportType: string | null;
    answers: Partial<Record<ClarificationQuestionKey, string>>;
    nowIso?: string;
  },
): CompanySettings {
  const companySettings = coerceCompanySettings(settings);
  const templates = getDocumentImportTemplates(companySettings);
  const nowIso = input.nowIso ?? new Date().toISOString();
  const provider = normalizeString(input.provider);
  const sourceFolder = normalizeString(input.sourceFolder);
  const documentKind = normalizeString(input.documentKind);
  const reportType = normalizeString(input.reportType);
  const answers = normalizeAnswers(input.answers);

  if (!sourceFolder || Object.keys(answers).length === 0) {
    companySettings.documentImportTemplates = templates;
    return companySettings;
  }

  const existingIndex = templates.findIndex((template) => {
    return (
      template.provider === provider &&
      template.sourceFolder === sourceFolder &&
      template.documentKind === documentKind &&
      template.reportType === reportType
    );
  });

  if (existingIndex >= 0) {
    const current = templates[existingIndex]!;
    templates[existingIndex] = {
      ...current,
      answers: {
        ...current.answers,
        ...answers,
      },
      updatedAt: nowIso,
    };
  } else {
    templates.unshift({
      id: randomUUID(),
      provider,
      sourceFolder,
      documentKind,
      reportType,
      answers,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  companySettings.documentImportTemplates = templates.slice(0, MAX_TEMPLATES);
  return companySettings;
}

export function matchDocumentImportTemplates(
  settings: unknown,
  input: {
    provider: string | null;
    sourceFolder: string | null;
    documentKind?: string | null;
    reportType?: string | null;
  },
): DocumentImportTemplate[] {
  const provider = normalizeString(input.provider);
  const sourceFolder = normalizeString(input.sourceFolder);
  const documentKind = normalizeString(input.documentKind);
  const reportType = normalizeString(input.reportType);

  return getDocumentImportTemplates(settings)
    .map((template) => {
      let score = 0;
      if (template.sourceFolder && sourceFolder && template.sourceFolder === sourceFolder) {
        score += 4;
      } else if (template.sourceFolder) {
        return null;
      }
      if (template.provider && provider && template.provider === provider) {
        score += 2;
      } else if (template.provider && provider !== template.provider) {
        return null;
      }
      if (template.documentKind && documentKind && template.documentKind === documentKind) {
        score += 2;
      } else if (template.documentKind && documentKind && documentKind !== template.documentKind) {
        return null;
      }
      if (template.reportType && reportType && template.reportType === reportType) {
        score += 1;
      } else if (template.reportType && reportType && reportType !== template.reportType) {
        return null;
      }
      return { template, score };
    })
    .filter((entry): entry is { template: DocumentImportTemplate; score: number } => entry !== null)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.template);
}

export function buildDocumentImportTemplateDefaults(
  settings: unknown,
  input: {
    provider: string | null;
    sourceFolder: string | null;
    documentKind?: string | null;
    reportType?: string | null;
  },
): ClarificationAnswerMap {
  return matchDocumentImportTemplates(settings, input)
    .slice(0, 3)
    .reduce<ClarificationAnswerMap>((acc, template) => {
      for (const [key, value] of Object.entries(template.answers)) {
        if (!acc[key as ClarificationQuestionKey] && typeof value === "string") {
          acc[key as ClarificationQuestionKey] = value;
        }
      }
      return acc;
    }, {});
}
