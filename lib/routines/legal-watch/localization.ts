import { anthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModelUsage } from "ai";

import type { AppLocale } from "@/lib/i18n/config";

export type LegalWatchDisplayLocale = AppLocale;

export interface LegalWatchDisplayTranslation {
  title: string;
  summary: string;
  status: "source" | "translated" | "fallback";
}

export type LegalWatchDisplayTranslations = Record<
  LegalWatchDisplayLocale,
  LegalWatchDisplayTranslation
>;

export interface LegalWatchDisplayTranslationBundle {
  sourceLanguage: string | null;
  generatedAt: string;
  provider: "anthropic" | "none";
  model: string | null;
  translations: LegalWatchDisplayTranslations;
  error?: string;
}

export interface TranslateLegalWatchDisplayInput {
  title: string;
  summary: string;
  sourceLanguage?: string | null;
  generatedAt?: string;
  env?: NodeJS.ProcessEnv;
  generate?: (input: {
    model: string;
    system: string;
    prompt: string;
  }) => Promise<{ text: string; usage?: LanguageModelUsage }>;
  onUsage?: (usage: LanguageModelUsage, model: string) => Promise<void> | void;
}

const DISPLAY_LOCALES: LegalWatchDisplayLocale[] = ["en", "ru", "id"];
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TITLE_CHARS = 220;
const MAX_SUMMARY_CHARS = 900;

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? normalized.slice(0, max).trim() : normalized;
}

function defaultBundle(input: {
  title: string;
  summary: string;
  sourceLanguage: string | null;
  generatedAt: string;
  provider?: "anthropic" | "none";
  model?: string | null;
  error?: string;
}): LegalWatchDisplayTranslationBundle {
  const title = truncate(input.title, MAX_TITLE_CHARS);
  const summary = truncate(input.summary, MAX_SUMMARY_CHARS);
  const translations = Object.fromEntries(
    DISPLAY_LOCALES.map((locale) => [
      locale,
      {
        title,
        summary,
        status: locale === input.sourceLanguage ? "source" : "fallback",
      },
    ]),
  ) as LegalWatchDisplayTranslations;

  return {
    sourceLanguage: input.sourceLanguage,
    generatedAt: input.generatedAt,
    provider: input.provider ?? "none",
    model: input.model ?? null,
    translations,
    ...(input.error ? { error: input.error } : {}),
  };
}

function extractJsonPayload(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("translation response did not contain JSON");
  return JSON.parse(match[0]);
}

function readTranslationEntry(
  value: unknown,
  fallback: LegalWatchDisplayTranslation,
): LegalWatchDisplayTranslation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim()
    ? truncate(record.title, MAX_TITLE_CHARS)
    : fallback.title;
  const summary = typeof record.summary === "string" && record.summary.trim()
    ? truncate(record.summary, MAX_SUMMARY_CHARS)
    : fallback.summary;
  return { title, summary, status: "translated" };
}

function parseTranslationResponse(
  text: string,
  fallback: LegalWatchDisplayTranslationBundle,
): LegalWatchDisplayTranslationBundle {
  const payload = extractJsonPayload(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("translation response was not an object");
  }
  const record = payload as Record<string, unknown>;
  const translationsRecord =
    record.translations && typeof record.translations === "object" && !Array.isArray(record.translations)
      ? record.translations as Record<string, unknown>
      : record;

  return {
    ...fallback,
    provider: "anthropic",
    translations: {
      en: readTranslationEntry(translationsRecord.en, fallback.translations.en),
      ru: readTranslationEntry(translationsRecord.ru, fallback.translations.ru),
      id: readTranslationEntry(translationsRecord.id, fallback.translations.id),
    },
  };
}

function buildPrompt(input: {
  title: string;
  summary: string;
  sourceLanguage: string | null;
}): string {
  return [
    "Translate this Legal Watch candidate for UI review.",
    "Return JSON only with translations.en, translations.ru, translations.id.",
    "Keep names, legal instrument numbers, acronyms, dates, URLs, and agency names exact.",
    "Do not add legal advice or new facts.",
    "Use concise reviewer-facing language.",
    "",
    `Source language hint: ${input.sourceLanguage ?? "unknown"}`,
    `Title: ${input.title}`,
    `Summary: ${input.summary}`,
  ].join("\n");
}

export function getLegalWatchTranslationModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.LEGAL_WATCH_TRANSLATION_MODEL?.trim() || DEFAULT_MODEL;
}

export async function translateLegalWatchDisplay(
  input: TranslateLegalWatchDisplayInput,
): Promise<LegalWatchDisplayTranslationBundle> {
  const env = input.env ?? process.env;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sourceLanguage = input.sourceLanguage ?? "id";
  const model = getLegalWatchTranslationModel(env);
  const fallback = defaultBundle({
    title: input.title,
    summary: input.summary,
    sourceLanguage,
    generatedAt,
  });

  if (!env.ANTHROPIC_API_KEY?.trim()) {
    return {
      ...fallback,
      error: "ANTHROPIC_API_KEY is not configured; showing source-language display text",
    };
  }

  try {
    const runGenerate = input.generate ??
      ((args: { model: string; system: string; prompt: string }) =>
        generateText({
          model: anthropic(args.model),
          system: args.system,
          prompt: args.prompt,
          temperature: 0,
          maxRetries: 1,
        }));
    const { text, usage } = await runGenerate({
      model,
      system:
        "You translate legal/regulatory monitoring summaries for a finance operating system. Return strict JSON only.",
      prompt: buildPrompt({
        title: input.title,
        summary: input.summary,
        sourceLanguage,
      }),
    });
    if (usage) await input.onUsage?.(usage, model);
    return parseTranslationResponse(text, {
      ...fallback,
      provider: "anthropic",
      model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return defaultBundle({
      title: input.title,
      summary: input.summary,
      sourceLanguage,
      generatedAt,
      provider: "anthropic",
      model,
      error: message,
    });
  }
}
