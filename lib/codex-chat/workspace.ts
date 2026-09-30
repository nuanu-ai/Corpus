import { Dirent } from "fs";
import { access, chmod, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, isAbsolute, join, relative, resolve } from "path";

const DEFAULT_CODEX_CHAT_WORKSPACE_ROOT = resolve(
  /* turbopackIgnore: true */
  process.env.CODEX_CHAT_WORKSPACE_DIR ?? join(tmpdir(), "corpus-codex-chat-workspaces"),
);

export interface EnsureCodexChatWorkspaceInput {
  companyId: string;
  threadId: string;
  userId: string;
  title: string;
  authProfileId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function getCodexChatWorkspaceRoot(): string {
  return DEFAULT_CODEX_CHAT_WORKSPACE_ROOT;
}

function resolveWorkspacePath(rootPath: string, relativePath: string): string {
  const fullPath = resolve(rootPath, relativePath);
  const pathFromRoot = relative(rootPath, fullPath);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Codex chat artifact path escapes workspace");
  }
  return fullPath;
}

function inferArtifactMimeType(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".tsv")) return "text/tab-separated-values";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return null;
}

async function listFilesRecursive(rootPath: string): Promise<string[]> {
  async function walk(currentPath: string): Promise<string[]> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry: Dirent) => {
        const entryPath = join(currentPath, entry.name);
        if (entry.isDirectory()) {
          return walk(entryPath);
        }
        if (entry.isFile()) {
          return [entryPath];
        }
        return [];
      }),
    );
    return nested.flat();
  }

  try {
    return await walk(rootPath);
  } catch {
    return [];
  }
}

export function getCodexChatThreadWorkspacePath(companyId: string, userId: string, threadId: string): string {
  return resolveWorkspacePath(
    getCodexChatWorkspaceRoot(),
    join(companyId, userId, threadId),
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await exists(path)) return;
  await writeFile(path, content, "utf8");
}

function buildWorkspaceAgentsMd(repoRoot: string): string {
  return [
    "# Codex Chat Workspace",
    "",
    "This workspace belongs to Corpus `codex_chat`.",
    "",
    "Operating rules:",
    "- Treat this workspace as the writable surface for notes, exports, and artifacts.",
    `- The Corpus repository lives at: ${repoRoot}`,
    `- Read the project architecture at: ${repoRoot}/docs/architecture.md`,
    `- Read the security model at: ${repoRoot}/docs/security-model.md`,
    "- Do not claim external side effects unless you executed them.",
    "- Do not edit repository code unless the user explicitly asked for product code changes.",
    "- Keep durable artifacts under `artifacts/` and scratch work under `scratch/`.",
    "",
  ].join("\n");
}

function buildWorkspaceSkillsMd(repoRoot: string): string {
  return [
    "# Corpus Runtime Skills",
    "",
    "Use these sources in this order:",
    `1. ${repoRoot}/AGENTS.md`,
    `2. ${repoRoot}/docs/architecture.md`,
    `3. ${repoRoot}/docs/security-model.md`,
    `4. ${repoRoot}/docs/configuration.md`,
    "",
    "Stable subsystem boundaries:",
    "- auth-tenancy",
    "- documents-ingestion",
    "- connectors-integrations",
    "- company-db",
    "- chat-consultant",
    "- ops-deploy",
    "",
    "Live runtime access in this Codex thread:",
    "- `./bin/corpus-agent session` shows the live Corpus agent session, scopes, and company context.",
    "- `./bin/corpus-agent connectors` shows live connector status and available actions.",
    "- `./bin/corpus-agent list-tools` shows the MCP tool surface.",
    "- `./bin/corpus-agent connector-action odoo ...` is the direct Odoo path.",
    "- `./bin/corpus-agent query ...`, `search ...`, and `get-file ...` are the direct Company-DB paths.",
    "- `./bin/corpus-agent documents ...` is the direct documents path.",
    "",
    "When you need company context, prefer repository docs and structured runtime state over guesswork.",
    "",
  ].join("\n");
}

function buildWorkspaceAccessMd(): string {
  return [
    "# Corpus Live Access",
    "",
    "This Codex thread has a live Corpus tool bridge.",
    "",
    "Shell env already configured for this run:",
    "- `CORPUS_APP_URL`",
    "- `CORPUS_API_KEY`",
    "- `CORPUS_COMPANY_ID`",
    "- `CORPUS_AGENT_MCP_URL`",
    "",
    "Primary command:",
    "- `./bin/corpus-agent session`",
    "- `./bin/corpus-agent connectors`",
    "- `./bin/corpus-agent list-tools`",
    "",
    "Common examples:",
    "- `./bin/corpus-agent connector-action odoo search_records '{\"model\":\"account.move\",\"domain\":[[\"move_type\",\"=\",\"out_invoice\"]],\"fields\":[\"id\",\"name\"],\"limit\":10}'`",
    "- `./bin/corpus-agent query '{\"query\":\"march 2026 f&b revenue\",\"limit\":5}'`",
    "- `./bin/corpus-agent search \"odoo revenue\" '{\"limit\":5}'`",
    "- `./bin/corpus-agent documents '{\"limit\":20}'`",
    "- `./bin/corpus-agent get-file finance/_summary.qmd`",
    "",
    "Discipline:",
    "- Before claiming a connector is unavailable, run `./bin/corpus-agent connectors`.",
    "- Before claiming company data is unavailable, run `./bin/corpus-agent session` and inspect the MCP tools.",
    "- Prefer this live bridge over asking the user for exports when the connector or Company-DB already has the data.",
    "",
  ].join("\n");
}

function buildWorkspaceAgentCli(repoRoot: string): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `node "${repoRoot}/scripts/agent-mcp-cli.mjs" "$@"`,
    "",
  ].join("\n");
}

export async function ensureCodexChatThreadWorkspace(
  input: EnsureCodexChatWorkspaceInput,
): Promise<{ rootPath: string; manifestPath: string }> {
  const rootPath = getCodexChatThreadWorkspacePath(input.companyId, input.userId, input.threadId);
  const manifestPath = join(rootPath, "thread.json");
  const artifactsPath = join(rootPath, "artifacts");
  const binPath = join(rootPath, "bin");
  const scratchPath = join(rootPath, "scratch");
  const repoRoot = process.cwd();

  await mkdir(rootPath, { recursive: true });
  await mkdir(artifactsPath, { recursive: true });
  await mkdir(binPath, { recursive: true });
  await mkdir(scratchPath, { recursive: true });

  await writeFile(join(rootPath, "AGENTS.md"), `${buildWorkspaceAgentsMd(repoRoot)}\n`, "utf8");
  await writeFile(join(rootPath, "CORPUS_SKILLS.md"), `${buildWorkspaceSkillsMd(repoRoot)}\n`, "utf8");
  await writeFile(join(rootPath, "CORPUS_ACCESS.md"), `${buildWorkspaceAccessMd()}\n`, "utf8");
  await writeFile(join(binPath, "corpus-agent"), buildWorkspaceAgentCli(repoRoot), "utf8");
  await chmod(join(binPath, "corpus-agent"), 0o755);

  await writeIfMissing(
    join(rootPath, "TASK.md"),
    ["# Task", "", "- Objective:", "- Constraints:", "- Deliverable:", ""].join("\n"),
  );
  await writeIfMissing(
    join(rootPath, "MEMORY.md"),
    ["# Memory", "", "Durable Codex chat context for this thread.", ""].join("\n"),
  );
  await writeIfMissing(
    join(rootPath, "SESSION.md"),
    ["# Session", "", "Codex session breadcrumbs and resume notes live here.", ""].join("\n"),
  );

  const createdAt = input.createdAt ?? new Date();
  const updatedAt = input.updatedAt ?? createdAt;
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        runtime: "codex_chat",
        companyId: input.companyId,
        threadId: input.threadId,
        userId: input.userId,
        authProfileId: input.authProfileId ?? null,
        title: input.title,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { rootPath, manifestPath };
}

export interface CodexWorkspaceArtifactFile {
  title: string;
  fileName: string;
  filePath: string;
  fullPath: string;
  mimeType: string | null;
  sizeBytes: number;
  modifiedAt: string;
}

export async function listCodexChatArtifacts(input: {
  companyId: string;
  userId: string;
  threadId: string;
}): Promise<CodexWorkspaceArtifactFile[]> {
  const rootPath = getCodexChatThreadWorkspacePath(input.companyId, input.userId, input.threadId);
  const artifactsRoot = join(rootPath, "artifacts");
  const files = await listFilesRecursive(artifactsRoot);

  const artifacts = await Promise.all(
    files.map(async (fullPath) => {
      const details = await stat(fullPath);
      const filePath = relative(rootPath, fullPath);
      const fileName = basename(fullPath);
      return {
        title: fileName,
        fileName,
        filePath,
        fullPath,
        mimeType: inferArtifactMimeType(filePath),
        sizeBytes: details.size,
        modifiedAt: details.mtime.toISOString(),
      } satisfies CodexWorkspaceArtifactFile;
    }),
  );

  return artifacts.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function readCodexChatArtifactFile(input: {
  companyId: string;
  userId: string;
  threadId: string;
  relativePath: string;
}): Promise<{ content: string; fullPath: string; rootPath: string }> {
  const rootPath = getCodexChatThreadWorkspacePath(input.companyId, input.userId, input.threadId);
  const fullPath = resolveWorkspacePath(rootPath, input.relativePath);
  const content = await readFile(fullPath, "utf8");
  return { content, fullPath, rootPath };
}

export async function readCodexChatArtifactData(input: {
  companyId: string;
  userId: string;
  threadId: string;
  relativePath: string;
}): Promise<{ content: Buffer; fullPath: string; rootPath: string }> {
  const rootPath = getCodexChatThreadWorkspacePath(input.companyId, input.userId, input.threadId);
  const fullPath = resolveWorkspacePath(rootPath, input.relativePath);
  const content = await readFile(fullPath);
  return { content, fullPath, rootPath };
}
