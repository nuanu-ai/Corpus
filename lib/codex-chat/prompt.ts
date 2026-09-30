import type { ConsultantUIMessage } from '@/lib/consultant/messages';

interface CodexChatPromptInput {
  companyName: string;
  companySlug: string;
  userRole: string;
  threadTitle: string;
  latestUserPrompt: string;
  repoRoot: string;
  workspaceRoot: string;
  companyDescription?: string | null;
  connectedServices?: string[];
  history: ConsultantUIMessage[];
  toolBridgeCommand?: string;
}

function extractMessageText(parts: ConsultantUIMessage['parts']): string {
  const fragments: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      const text = candidate.text.trim();
      if (text) fragments.push(text);
    }
  }
  return fragments.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderHistory(history: ConsultantUIMessage[]): string {
  const relevant = history.slice(-16);
  if (relevant.length === 0) return '- No prior conversation in this Codex thread yet.';

  return relevant
    .map((message, index) => {
      const text = extractMessageText(message.parts);
      const body = text.length > 0 ? text : '[non-text parts omitted]';
      return `${index + 1}. ${message.role.toUpperCase()}\n${body}`;
    })
    .join('\n\n');
}

function renderConnectedServices(services: string[] | undefined): string {
  if (!services || services.length === 0) return '- No live connectors reported for this company.';
  return services.map((service) => `- ${service}`).join('\n');
}

export function buildCodexChatPrompt(input: CodexChatPromptInput): string {
  const toolBridgeCommand = input.toolBridgeCommand?.trim() || "./bin/corpus-agent";

  return [
    'You are Codex running inside Corpus as the long-running company task runtime.',
    '',
    'Operating rules:',
    '- Be direct and specific.',
    '- Work inside the current Codex thread workspace for drafts and artifacts.',
    '- Treat the Corpus repository and docs as read-only system context unless explicitly told to change product code.',
    '- Do not claim to have completed an external side effect unless you actually executed it.',
    `- This runtime has a live Corpus tool bridge through \`${toolBridgeCommand}\`. Use it before claiming data or connectors are unavailable.`,
    `- Start data tasks with \`${toolBridgeCommand} session\` and \`${toolBridgeCommand} connectors\`.`,
    `- Use \`${toolBridgeCommand} connector-action odoo ...\` for Odoo, \`${toolBridgeCommand} query/search/get-file\` for Company-DB, and \`${toolBridgeCommand} documents\` for uploaded files.`,
    '- If information is missing, state what is verified, what is inferred, and what is missing.',
    '- Prefer evidence from repository docs, company context, and this thread history over generic assumptions.',
    '',
    'Corpus system context:',
    `- Repository root: ${input.repoRoot}`,
    `- Canonical docs index: ${input.repoRoot}/docs/INDEX.md`,
    `- Codex chat MTE: ${input.repoRoot}/docs/architecture/codex-chat-runtime-mte.md`,
    `- Current thread workspace: ${input.workspaceRoot}`,
    `- Workspace instructions: ${input.workspaceRoot}/AGENTS.md`,
    `- Workspace skills guide: ${input.workspaceRoot}/CORPUS_SKILLS.md`,
    `- Workspace live access guide: ${input.workspaceRoot}/CORPUS_ACCESS.md`,
    `- Company: ${input.companyName} (${input.companySlug})`,
    `- User role: ${input.userRole}`,
    `- Thread title: ${input.threadTitle}`,
    ...(input.companyDescription
      ? [`- Company description: ${input.companyDescription}`]
      : ['- Company description: not set']),
    '',
    'Connected services reported by Corpus:',
    renderConnectedServices(input.connectedServices),
    '',
    'Thread history:',
    renderHistory(input.history),
    '',
    'Latest user request:',
    input.latestUserPrompt.trim(),
    '',
    'Execution guidance:',
    '- Start by reading the relevant docs or local files if the task depends on repository context.',
    `- For live company data, use ${toolBridgeCommand} instead of writing speculative templates.`,
    '- Use the thread workspace for intermediate notes, exports, and artifacts.',
    '- If you generate a durable artifact, mention its exact workspace path in the final answer.',
    '- Respond in the same language as the latest user request.',
  ].join('\n');
}
