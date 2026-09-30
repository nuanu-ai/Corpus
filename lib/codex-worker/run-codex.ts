import { execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { promisify } from "util";

import type { CodexAgentOutput, CodexArtifactManifest } from "./types";
import { buildCodexOutputSchema, validateCodexOutput } from "./output";
import { buildCodexPrompt } from "./prompt";
import { buildCodexCliEnv } from "./auth";

const execFileAsync = promisify(execFile);
const CODEX_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "NO_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "CI",
  "CODEX_HOME",
  "CODEX_AUTH_MODE",
  "CODEX_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "CORPUS_APP_URL",
  "CORPUS_API_KEY",
  "CORPUS_COMPANY_ID",
  "CORPUS_AGENT_MCP_URL",
  "CORPUS_AGENT_CONNECTORS_URL",
  "CORPUS_AGENT_SESSION_URL",
] as const;

const DEFAULT_CODEX_EXEC_TIMEOUTS_MS: Record<string, number> = {
  image: 1000 * 60 * 20,
  csv: 1000 * 60 * 20,
  knowledge: 1000 * 60 * 20,
  default: 1000 * 60 * 90,
  pdf: 1000 * 60 * 150,
  excel: 1000 * 60 * 150,
};
const DEFAULT_MAX_ATTACHED_IMAGES = 16;

export interface RunCodexAnalysisOptions {
  workspaceDir: string;
  manifest: CodexArtifactManifest;
  fileType: string;
  model?: string | null;
  codexBin?: string;
  timeoutMs?: number;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function parseTimeoutMs(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTimeoutEnvKey(fileType: string): string {
  return fileType.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function resolveMaxAttachedImages(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.CODEX_MAX_ATTACHED_IMAGES ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_ATTACHED_IMAGES;
}

function collectImageAttachments(
  workspaceDir: string,
  manifest: CodexArtifactManifest,
  fileType: string,
): string[] {
  const maxImages = resolveMaxAttachedImages(process.env);
  if (maxImages === 0) return [];

  const seen = new Set<string>();
  const images: string[] = [];

  function add(relativePath: string | undefined): void {
    if (!relativePath || images.length >= maxImages) return;
    if (relativePath.startsWith("/") || relativePath.includes("\0")) return;
    const fullPath = join(workspaceDir, relativePath);
    if (seen.has(fullPath)) return;
    seen.add(fullPath);
    images.push(fullPath);
  }

  if (fileType === "image") {
    add(manifest.originalFilePath);
  }
  for (const unit of manifest.units) {
    add(unit.visualPath);
  }

  return images;
}

export function buildCodexSubprocessEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = {} as NodeJS.ProcessEnv;
  for (const key of CODEX_ENV_ALLOWLIST) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      nextEnv[key] = value;
    }
  }
  return nextEnv;
}

export function resolveCodexExecTimeoutMs(
  fileType: string,
  explicitTimeoutMs?: number | null,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (explicitTimeoutMs && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }

  const typeSpecific = parseTimeoutMs(env[`CODEX_EXEC_TIMEOUT_MS_${normalizeTimeoutEnvKey(fileType)}`]);
  if (typeSpecific) return typeSpecific;

  const globalTimeout = parseTimeoutMs(env.CODEX_EXEC_TIMEOUT_MS);
  if (globalTimeout) return globalTimeout;

  return (
    DEFAULT_CODEX_EXEC_TIMEOUTS_MS[fileType] ??
    DEFAULT_CODEX_EXEC_TIMEOUTS_MS.default
  );
}

export function buildCodexExecArgs(input: {
  schemaPath: string;
  outputPath: string;
  prompt: string;
  model?: string | null;
  imagePaths?: string[];
}): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--full-auto",
    "--ephemeral",
    "--color",
    "never",
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.outputPath,
  ];

  if (input.model) {
    args.push("--model", input.model);
  }

  // Codex CLI defines --image as a variadic option. Put the prompt before
  // images so it cannot be swallowed as another image path.
  args.push(input.prompt);

  for (const imagePath of input.imagePaths ?? []) {
    args.push("--image", imagePath);
  }

  return args;
}

export async function runCodexAnalysis(
  options: RunCodexAnalysisOptions,
): Promise<{ output: CodexAgentOutput; model: string | null }> {
  const codexBin = options.codexBin ?? process.env.CODEX_BIN ?? "codex";
  const execTimeout = resolveCodexExecTimeoutMs(
    options.fileType,
    options.timeoutMs,
    process.env,
  );
  const schemaPath = join(options.workspaceDir, ".codex", "output-schema.json");
  const promptPath = join(options.workspaceDir, ".codex", "prompt.txt");
  const outputPath = join(options.workspaceDir, ".codex", "last-message.json");
  const prompt = buildCodexPrompt(options.manifest);

  await ensureDir(dirname(schemaPath));
  await writeFile(
    schemaPath,
    JSON.stringify(buildCodexOutputSchema(), null, 2),
    "utf8",
  );
  await writeFile(promptPath, prompt, "utf8");

  const args = buildCodexExecArgs({
    schemaPath,
    outputPath,
    prompt,
    model: options.model,
    imagePaths: collectImageAttachments(
      options.workspaceDir,
      options.manifest,
      options.fileType,
    ),
  });

  await execFileAsync(codexBin, args, {
    cwd: options.workspaceDir,
    maxBuffer: 1024 * 1024 * 20,
    timeout: execTimeout,
    killSignal: "SIGTERM",
    env: {
      ...buildCodexCliEnv(buildCodexSubprocessEnv(process.env)),
    },
  });

  const raw = await import("fs/promises").then((fs) => fs.readFile(outputPath, "utf8"));
  const parsed = JSON.parse(raw) as unknown;
  const output = validateCodexOutput(parsed, options.manifest);

  return {
    output,
    model: options.model ?? null,
  };
}
