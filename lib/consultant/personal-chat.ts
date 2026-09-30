import { getDomainSummary, queryEntities } from "@/lib/company-db/client";
import {
  getPersonalCompanyDbRequestOptions,
  loadPersonalLinkedWorkspaces,
  loadPersonalSurfaceSummary,
  type PersonalSurfaceContext,
} from "@/lib/company-db/personal-surfaces";

const MAX_PROMPT_SECTION_CHARS = 1_500;
const MAX_TOTAL_CONTEXT_CHARS = 12_000;

function trimForPrompt(value: string | null | undefined, maxChars = MAX_PROMPT_SECTION_CHARS): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars).trimEnd()}...`
    : normalized;
}

function firstLine(value: string | null | undefined): string | null {
  const trimmed = trimForPrompt(value, 600);
  if (!trimmed) return null;
  return trimmed.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
}

export async function buildPersonalChatContext(
  context: PersonalSurfaceContext,
): Promise<string> {
  const requestOptions = await getPersonalCompanyDbRequestOptions(context);
  const [todaySummary, inboxSummary, timelineSummary, workspacesSummary, commitmentsSummary, documentsSummary, recentDocuments, linkedWorkspaces] =
    await Promise.all([
      loadPersonalSurfaceSummary("today", context).catch(() => null),
      loadPersonalSurfaceSummary("inbox", context).catch(() => null),
      loadPersonalSurfaceSummary("timeline", context).catch(() => null),
      loadPersonalSurfaceSummary("workspaces", context).catch(() => null),
      loadPersonalSurfaceSummary("commitments", context).catch(() => null),
      getDomainSummary("documents", requestOptions).catch(() => null),
      queryEntities({ domain: "documents", limit: 8, view: "summary" }, requestOptions).catch(() => []),
      loadPersonalLinkedWorkspaces(context).catch(() => []),
    ]);

  const sections: string[] = [];
  let usedChars = 0;

  function pushSection(title: string, body: string | null) {
    const trimmed = trimForPrompt(body);
    if (!trimmed) return;
    const section = `## ${title}\n${trimmed}`;
    if (usedChars + section.length > MAX_TOTAL_CONTEXT_CHARS) return;
    sections.push(section);
    usedChars += section.length;
  }

  pushSection("Personal Today", todaySummary?.body ?? null);
  pushSection("Personal Inbox", inboxSummary?.body ?? null);
  pushSection("Personal Timeline", timelineSummary?.body ?? null);
  pushSection("Personal Commitments", commitmentsSummary?.body ?? null);
  pushSection("Personal Documents", documentsSummary?.body ?? null);
  pushSection("Personal Workspaces", workspacesSummary?.body ?? null);

  if (recentDocuments.length > 0) {
    const block = recentDocuments
      .map((record) => {
        const title =
          typeof record.frontmatter.title === "string" && record.frontmatter.title.trim().length > 0
            ? record.frontmatter.title.trim()
            : record.title ?? record.filePath;
        return `- ${title} (${record.filePath})`;
      })
      .join("\n");
    pushSection("Recent Personal Documents", block);
  }

  if (linkedWorkspaces.length > 0) {
    const block = linkedWorkspaces
      .map((workspace) => {
        const liveSummary = firstLine(workspace.summary);
        const mirrorSummary = firstLine(workspace.mirrorSummary);
        const note = firstLine(workspace.noteBody);
        const waitingFors = (workspace.waitingFors ?? []).slice(0, 3).join("; ");
        const parts = [
          `${workspace.companyName} (${workspace.role})`,
          liveSummary ? `live: ${liveSummary}` : null,
          mirrorSummary ? `mirror: ${mirrorSummary}` : null,
          note ? `note: ${note}` : null,
          waitingFors ? `waiting: ${waitingFors}` : null,
        ].filter(Boolean);
        return `- ${parts.join(" | ")}`;
      })
      .join("\n");
    pushSection("Linked Company Workspaces", block);
  }

  return sections.length > 0
    ? sections.join("\n\n")
    : "No personal summaries or linked workspace summaries are available yet.";
}

export function buildPersonalChatSystemPrompt(contextText: string): string {
  return [
    "You are Corpus Personal Copilot for the user's personal workspace.",
    "This chat is scoped to the user's personal tenant, not a company workspace.",
    "Use a practical, concise style. Help with planning, notes, drafting, personal organization, and turning discussion into durable artifacts.",
    "Important boundaries:",
    "- Do not claim you can inspect live company ledgers, company connectors, or company databases beyond the linked workspace summaries explicitly provided below.",
    "- If the user needs live company data or wants to act inside a company runtime, tell them to switch to the relevant company workspace.",
    "- Do not claim you inspected uploaded personal files unless their contents were routed into the prompt or a tool returned them.",
    "Artifact behavior:",
    "- Use create_consultant_artifact for durable notes, memos, plans, checklists, or other text deliverables that should stay in the personal workspace.",
    "- Use create_consultant_export only when the user explicitly asks for a spreadsheet or delimited export.",
    "- Personal artifacts stay personal. Never talk about sharing to company documents from this surface.",
    "Web research:",
    "- The web_search tool is available (Anthropic-native, capped at 5 calls per turn). Use it when a draft, fact-check, or planning question genuinely depends on current outside information (post-cutoff news, prices, regulations). Prefer the user's own context first; reach for web_search only when the answer plainly needs the outside world.",
    "",
    "Available personal context:",
    contextText,
  ].join("\n");
}
