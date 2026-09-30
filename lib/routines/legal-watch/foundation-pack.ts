import { toQmd } from "@/lib/company-db/summary/qmd";
import {
  canPromoteLegalRuleFromSource,
  type RoutineSourceDefinition,
} from "@/lib/routines/source-registry";
import {
  BKPM_LEGAL_WATCH_JURISDICTION,
  BKPM_LEGAL_WATCH_ROUTINE_SLUG,
  BKPM_LEGAL_WATCH_SOURCES,
  BKPM_SOURCE_REGISTRY_VERIFIED_AS_OF,
} from "@/lib/routines/legal-watch/bkpm-sources";

export const BKPM_LEGAL_WATCH_BASE_PATH = "legal/watch/bkpm";

export interface LegalWatchTopicStub {
  readonly slug: string;
  readonly title: string;
  readonly topicTags: readonly string[];
  readonly sourceKeys: readonly string[];
  readonly reviewerQuestions: readonly string[];
}

export interface FoundationPackDocument {
  readonly path: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly content: string;
}

export interface LegalWatchFoundationPack {
  readonly sourceRegistry: FoundationPackDocument;
  readonly legalMap: FoundationPackDocument;
  readonly topics: readonly FoundationPackDocument[];
  readonly documents: readonly FoundationPackDocument[];
}

export interface BuildFoundationPackOptions {
  readonly generatedAt?: string;
  readonly scopeType?: "company" | "project" | "operating_object" | "personal_project";
  readonly scopeId?: string | null;
  readonly reviewStatus?: "draft" | "review_required" | "reviewed";
  readonly sources?: readonly RoutineSourceDefinition[];
}

export const BKPM_LEGAL_WATCH_TOPICS = [
  {
    slug: "pt-pma",
    title: "PT PMA incorporation and foreign ownership",
    topicTags: ["pt-pma", "foreign-ownership", "investment-fields"],
    sourceKeys: [
      "permen-investasi-bkpm-5-2025",
      "pp-28-2025",
      "perpres-10-2021-bpk",
    ],
    reviewerQuestions: [
      "Which current source establishes PT PMA setup requirements?",
      "Which points need local lawyer, notary, or BKPM confirmation?",
    ],
  },
  {
    slug: "kbli",
    title: "KBLI classification",
    topicTags: ["kbli", "classification", "migration"],
    sourceKeys: [
      "bps-kbli-2025",
      "bps-kbli-2020-2025-conversion",
      "oss-guidance-manuals",
    ],
    reviewerQuestions: [
      "Which company records still reference KBLI 2020?",
      "Which OSS/BKPM workflows depend on the mapped KBLI code?",
    ],
  },
  {
    slug: "foreign-ownership",
    title: "Business fields open or restricted to foreign investment",
    topicTags: ["foreign-ownership", "investment-fields", "restrictions"],
    sourceKeys: ["perpres-10-2021-bpk", "jdih-bkpm"],
    reviewerQuestions: [
      "Is the restriction backed by the current primary regulation?",
      "Are sector-specific approvals or exceptions involved?",
    ],
  },
  {
    slug: "minimum-capital",
    title: "Minimum capital and paid-up capital",
    topicTags: ["minimum-capital", "pt-pma", "licensing"],
    sourceKeys: ["permen-investasi-bkpm-5-2025", "oss-guidance-manuals"],
    reviewerQuestions: [
      "Which current source backs the capital requirement?",
      "Is the requirement general, sector-specific, or workflow-specific?",
    ],
  },
  {
    slug: "oss-rba",
    title: "OSS RBA licensing, NIB, and business licenses",
    topicTags: ["oss-rba", "nib", "licensing", "risk-based-licensing"],
    sourceKeys: [
      "permen-investasi-bkpm-5-2025",
      "pp-28-2025",
      "oss-guidance-manuals",
    ],
    reviewerQuestions: [
      "Which steps are legal requirements and which are portal workflow guidance?",
      "Does the answer need an effective date or supersession warning?",
    ],
  },
  {
    slug: "lkpm",
    title: "LKPM reporting",
    topicTags: ["lkpm", "reporting", "oss-rba"],
    sourceKeys: ["permen-investasi-bkpm-5-2025", "oss-guidance-manuals"],
    reviewerQuestions: [
      "Which source establishes the reporting obligation?",
      "Which company/project facts are needed before giving practical guidance?",
    ],
  },
  {
    slug: "sanctions",
    title: "Sanctions and non-compliance",
    topicTags: ["sanctions", "non-compliance", "licensing"],
    sourceKeys: ["permen-investasi-bkpm-5-2025", "pp-28-2025"],
    reviewerQuestions: [
      "Which current regulation backs the sanction?",
      "Is the sanction active, superseded, or only portal guidance?",
    ],
  },
] as const satisfies readonly LegalWatchTopicStub[];

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function formatBoolean(value: boolean | undefined): string {
  return value ? "yes" : "no";
}

function formatInlineList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function sourceByKey(
  sources: readonly RoutineSourceDefinition[],
): Map<string, RoutineSourceDefinition> {
  return new Map(sources.map((source) => [source.sourceKey, source]));
}

function buildBaseFrontmatter(
  type: string,
  sourceSubset: readonly RoutineSourceDefinition[],
  options: Required<
    Pick<BuildFoundationPackOptions, "generatedAt" | "scopeType" | "reviewStatus">
  > &
    Pick<BuildFoundationPackOptions, "scopeId">,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    routine_slug: BKPM_LEGAL_WATCH_ROUTINE_SLUG,
    scope_type: options.scopeType,
    scope_id: options.scopeId ?? null,
    jurisdiction: BKPM_LEGAL_WATCH_JURISDICTION,
    topic_tags: uniqueStrings(sourceSubset.flatMap((source) => source.topicTags)),
    source_urls: sourceSubset.map((source) => source.url),
    source_titles: sourceSubset.map((source) => source.title),
    source_dates: uniqueStrings(
      sourceSubset.flatMap((source) => (source.sourceDate ? [source.sourceDate] : [])),
    ),
    retrieved_at: options.generatedAt,
    review_status: options.reviewStatus,
    reviewed_by: null,
    reviewed_at: null,
    confidence: null,
    legal_status: "foundation_seed",
    primary_source_required: true,
    secondary_commentary_only: false,
    supersession_status: "not_assessed",
    raw_event_ids: [],
    observation_ids: [],
    seed_verified_as_of: BKPM_SOURCE_REGISTRY_VERIFIED_AS_OF,
    ...extra,
  };
}

function buildDocument(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string,
): FoundationPackDocument {
  return {
    path,
    frontmatter,
    body,
    content: toQmd(frontmatter, body),
  };
}

function buildSourceRegistryBody(
  sources: readonly RoutineSourceDefinition[],
): string {
  const lines = [
    "# BKPM Legal Watch Source Registry",
    "",
    "This is the allowlisted source registry for the manual BKPM Legal Watch foundation pack. It is a source map, not reviewed legal advice.",
    "",
    "## Promotion Rules",
    "",
    "- A legal rule can be promoted only when backed by a primary source, or by an official source with an explicit primary-document link.",
    "- OSS, BPS, and JDIHN entries can support workflow and discovery, but obligations, prohibitions, sanctions, capital requirements, and licensing requirements still need primary-source confirmation.",
    "- Secondary commentary must remain `secondary_commentary_only` until confirmed by a primary or official source.",
    "- JDIHN is discovery-only; every discovered document must be verified against the originating agency or national regulation repository.",
    "",
    "## Sources",
    "",
  ];

  for (const source of sources) {
    lines.push(
      `### ${source.title}`,
      "",
      `- Source key: \`${source.sourceKey}\``,
      `- URL: ${source.url}`,
      `- Source type: \`${source.sourceType}\``,
      `- Trust tier: \`${source.trustTier}\``,
      `- Authority: ${source.authority}`,
      `- Jurisdiction: \`${source.jurisdiction}\``,
      `- Fetch mode: \`${source.fetchMode}\``,
      `- Check frequency: \`${source.checkFrequency}\``,
      `- Staleness risk: \`${source.stalenessRisk}\``,
      `- Allowed content types: ${formatInlineList(source.allowedContentTypes)}`,
      `- Topic tags: ${formatInlineList(source.topicTags)}`,
      `- Legal-rule promotion allowed: ${formatBoolean(
        canPromoteLegalRuleFromSource(source),
      )}`,
      `- Primary source required: ${formatBoolean(source.primarySourceRequired)}`,
      `- Secondary commentary only: ${formatBoolean(
        source.secondaryCommentaryOnly,
      )}`,
      `- Discovery only: ${formatBoolean(source.discoveryOnly)}`,
      `- Use for: ${source.useFor}`,
      `- Verified as of: ${source.verifiedAsOf}`,
    );

    if (source.instrumentNumber) {
      lines.push(`- Instrument number: ${source.instrumentNumber}`);
    }

    for (const note of source.notes ?? []) {
      lines.push(`- Note: ${note}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function buildLegalMapBody(
  sources: readonly RoutineSourceDefinition[],
): string {
  const primarySources = sources.filter((source) => source.trustTier === "primary");
  const officialSources = sources.filter(
    (source) => source.trustTier === "official",
  );
  const discoverySources = sources.filter((source) => source.discoveryOnly);

  return [
    "# BKPM Legal Foundation Map",
    "",
    "## Status",
    "",
    "- Draft foundation map for BKPM Legal Watch.",
    "- No legal conclusion in this file is reviewed advice.",
    "- Every answer must carry source, jurisdiction, source date or retrieved date, and review status.",
    "",
    "## Primary Source Anchors",
    "",
    ...primarySources.map(
      (source) => `- \`${source.sourceKey}\`: ${source.title} (${source.url})`,
    ),
    "",
    "## Official Support Sources",
    "",
    ...officialSources.map(
      (source) =>
        `- \`${source.sourceKey}\`: ${source.title}; primary source required: ${formatBoolean(
          source.primarySourceRequired,
        )}`,
    ),
    "",
    "## Discovery Sources",
    "",
    ...(discoverySources.length > 0
      ? discoverySources.map(
          (source) =>
            `- \`${source.sourceKey}\`: discovery only; verify every found item against the originating agency or national repository.`,
        )
      : ["- None."]),
    "",
    "## Topic Taxonomy",
    "",
    ...BKPM_LEGAL_WATCH_TOPICS.map(
      (topic) =>
        `- \`${topic.slug}\`: ${topic.title}; source keys: ${formatInlineList(
          topic.sourceKeys,
        )}`,
    ),
    "",
    "## Known Gaps And Review Queue",
    "",
    "- Recheck every seeded source before marking this foundation pack reviewed.",
    "- Confirm effective dates and supersession status for each regulation before creating lawyer-facing guidance.",
    "- Separate portal workflow guidance from binding law or regulation.",
    "- Require local lawyer, notary, or BKPM confirmation when the answer depends on company-specific facts or unsettled interpretation.",
  ].join("\n");
}

function buildTopicBody(
  topic: LegalWatchTopicStub,
  sources: readonly RoutineSourceDefinition[],
): string {
  const sourceMap = sourceByKey(sources);
  const topicSources = topic.sourceKeys
    .map((sourceKey) => sourceMap.get(sourceKey))
    .filter((source): source is RoutineSourceDefinition => Boolean(source));

  return [
    `# ${topic.title}`,
    "",
    "## Status",
    "",
    "- Draft topic stub for BKPM Legal Watch.",
    "- No reviewed legal conclusion has been recorded yet.",
    "- Do not answer as legal advice until a reviewed update or reviewed topic pack exists.",
    "",
    "## Scope",
    "",
    `- Topic tags: ${formatInlineList(topic.topicTags)}`,
    "",
    "## Seed Sources",
    "",
    ...topicSources.map(
      (source) =>
        `- \`${source.sourceKey}\`: ${source.title}; trust tier \`${source.trustTier}\`; ${source.url}`,
    ),
    "",
    "## Reviewer Checklist",
    "",
    ...topic.reviewerQuestions.map((question) => `- ${question}`),
    "- Confirm jurisdiction, effective date, source date, retrieved date, and review status before promotion.",
    "- Record gaps explicitly instead of inferring legal conclusions.",
    "",
    "## Open Gaps",
    "",
    "- No normalized observations have been reviewed for this topic yet.",
  ].join("\n");
}

function normalizeOptions(
  options: BuildFoundationPackOptions,
): Required<Pick<BuildFoundationPackOptions, "generatedAt" | "scopeType" | "reviewStatus">> &
  Pick<BuildFoundationPackOptions, "scopeId"> {
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scopeType: options.scopeType ?? "company",
    scopeId: options.scopeId ?? null,
    reviewStatus: options.reviewStatus ?? "draft",
  };
}

export function buildSourceRegistryQmd(
  options: BuildFoundationPackOptions = {},
): FoundationPackDocument {
  const normalizedOptions = normalizeOptions(options);
  const sources = options.sources ?? BKPM_LEGAL_WATCH_SOURCES;
  const frontmatter = buildBaseFrontmatter(
    "legal_watch_source_registry",
    sources,
    normalizedOptions,
    {
      title: "BKPM Legal Watch Source Registry",
      source_count: sources.length,
    },
  );

  return buildDocument(
    `${BKPM_LEGAL_WATCH_BASE_PATH}/source-registry.qmd`,
    frontmatter,
    buildSourceRegistryBody(sources),
  );
}

export function buildLegalMapQmd(
  options: BuildFoundationPackOptions = {},
): FoundationPackDocument {
  const normalizedOptions = normalizeOptions(options);
  const sources = options.sources ?? BKPM_LEGAL_WATCH_SOURCES;
  const frontmatter = buildBaseFrontmatter(
    "legal_watch_legal_map",
    sources,
    normalizedOptions,
    {
      title: "BKPM Legal Foundation Map",
    },
  );

  return buildDocument(
    `${BKPM_LEGAL_WATCH_BASE_PATH}/legal-map.qmd`,
    frontmatter,
    buildLegalMapBody(sources),
  );
}

export function buildTopicStubQmd(
  topic: LegalWatchTopicStub,
  options: BuildFoundationPackOptions = {},
): FoundationPackDocument {
  const normalizedOptions = normalizeOptions(options);
  const sources = options.sources ?? BKPM_LEGAL_WATCH_SOURCES;
  const sourceMap = sourceByKey(sources);
  const topicSources = topic.sourceKeys
    .map((sourceKey) => sourceMap.get(sourceKey))
    .filter((source): source is RoutineSourceDefinition => Boolean(source));
  const frontmatter = buildBaseFrontmatter(
    "legal_watch_topic_stub",
    topicSources,
    normalizedOptions,
    {
      title: topic.title,
      topic_slug: topic.slug,
      topic_tags: topic.topicTags,
    },
  );

  return buildDocument(
    `${BKPM_LEGAL_WATCH_BASE_PATH}/topics/${topic.slug}.qmd`,
    frontmatter,
    buildTopicBody(topic, sources),
  );
}

export function buildLegalWatchFoundationPack(
  options: BuildFoundationPackOptions = {},
): LegalWatchFoundationPack {
  const sourceRegistry = buildSourceRegistryQmd(options);
  const legalMap = buildLegalMapQmd(options);
  const topics = BKPM_LEGAL_WATCH_TOPICS.map((topic) =>
    buildTopicStubQmd(topic, options),
  );

  return {
    sourceRegistry,
    legalMap,
    topics,
    documents: [sourceRegistry, legalMap, ...topics],
  };
}
