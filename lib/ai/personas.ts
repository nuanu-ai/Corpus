/**
 * Persona configuration — central registry of chat "personas".
 *
 * A persona is a `{ slug, displayKey, defaultToolKeys?, systemPromptBuilder? }`
 * tuple that drives:
 *   - which `<persona>` segment routes to (`/api/chat/[persona]`),
 *   - which tool subset the LLM gets,
 *   - which `<persona_memory>` block is injected into the system prompt.
 *
 * `system_prompt` builders are deliberately NOT defined here — they land in
 * a follow-up PR alongside the actual persona prompts. This file is just
 * the source of truth for the slug list and default knobs.
 */

export const PERSONA_SLUGS = [
  "company", // legacy CEO chat / default
  "personal", // personal copilot
  "cfo",
  "legal",
  "marketing",
] as const;

export type PersonaSlug = (typeof PERSONA_SLUGS)[number];

export interface PersonaConfig {
  slug: PersonaSlug;
  /** i18n key under `chat.v2.persona.<slug>` for display name + description. */
  displayKey: string;
  /**
   * Whether this persona supports a long-term memory store
   * (`persona_memory_entries`). `company`/`personal` keep their existing
   * runtimes and don't use persona-memory injection by default.
   */
  hasMemory: boolean;
  /**
   * Whether the persona surface is shown to end users in the navigation
   * sidebar. `personal` lives in a separate workspace and isn't a
   * "switch-to" persona on the company surface.
   */
  visibleInCompanySidebar: boolean;
}

export const PERSONA_CONFIG: Record<PersonaSlug, PersonaConfig> = {
  company: {
    slug: "company",
    displayKey: "company",
    hasMemory: false,
    visibleInCompanySidebar: true,
  },
  personal: {
    slug: "personal",
    displayKey: "personal",
    hasMemory: false,
    visibleInCompanySidebar: false,
  },
  cfo: {
    slug: "cfo",
    displayKey: "cfo",
    hasMemory: true,
    visibleInCompanySidebar: true,
  },
  legal: {
    slug: "legal",
    displayKey: "legal",
    hasMemory: true,
    visibleInCompanySidebar: true,
  },
  marketing: {
    slug: "marketing",
    displayKey: "marketing",
    hasMemory: true,
    visibleInCompanySidebar: true,
  },
};

/** Validate a string against the slug allowlist. Trim and lower-case first. */
export function isPersonaSlug(input: unknown): input is PersonaSlug {
  return (
    typeof input === "string" &&
    (PERSONA_SLUGS as readonly string[]).includes(input)
  );
}

export function resolvePersonaSlug(
  input: unknown,
  fallback: PersonaSlug = "company",
): PersonaSlug {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim().toLowerCase();
  return isPersonaSlug(trimmed) ? trimmed : fallback;
}

/** Personas that are surfaced as switchable tabs in the company sidebar. */
export function listSidebarPersonas(): PersonaConfig[] {
  return PERSONA_SLUGS.map((slug) => PERSONA_CONFIG[slug]).filter(
    (p) => p.visibleInCompanySidebar,
  );
}

/** Personas that maintain a long-term memory store. */
export function listMemoryPersonas(): PersonaConfig[] {
  return PERSONA_SLUGS.map((slug) => PERSONA_CONFIG[slug]).filter(
    (p) => p.hasMemory,
  );
}
