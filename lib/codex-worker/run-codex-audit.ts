import { execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { promisify } from "util";

import { buildCodexCliEnv } from "./auth";
import { buildCodexAuditOutputSchema, validateCodexAuditOutput } from "./audit-output";
import { buildCodexAuditPrompt } from "./audit-prompt";
import type { CodexArtifactManifest, CodexAuditOutput } from "./types";
import {
  buildCodexSubprocessEnv,
  resolveCodexExecTimeoutMs,
} from "./run-codex";

const execFileAsync = promisify(execFile);

export interface RunCodexAuditAnalysisOptions {
  workspaceDir: string;
  manifest: CodexArtifactManifest;
  fileType: string;
  companyDbArtifactPaths: string[];
  domainSummaryPaths: string[];
  model?: string | null;
  codexBin?: string;
  timeoutMs?: number;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function runCodexAuditAnalysis(
  options: RunCodexAuditAnalysisOptions,
): Promise<{ output: CodexAuditOutput; model: string | null }> {
  const codexBin = options.codexBin ?? process.env.CODEX_BIN ?? "codex";
  const execTimeout = resolveCodexExecTimeoutMs(
    options.fileType,
    options.timeoutMs,
    process.env,
  );
  const schemaPath = join(options.workspaceDir, ".codex-audit", "output-schema.json");
  const promptPath = join(options.workspaceDir, ".codex-audit", "prompt.txt");
  const outputPath = join(options.workspaceDir, ".codex-audit", "last-message.json");
  const prompt = buildCodexAuditPrompt({
    manifest: options.manifest,
    companyDbArtifactPaths: options.companyDbArtifactPaths,
    domainSummaryPaths: options.domainSummaryPaths,
  });

  await ensureDir(dirname(schemaPath));
  await writeFile(
    schemaPath,
    JSON.stringify(buildCodexAuditOutputSchema(), null, 2),
    "utf8",
  );
  await writeFile(promptPath, prompt, "utf8");

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
    schemaPath,
    "--output-last-message",
    outputPath,
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.fileType === "image") {
    args.push("--image", join(options.workspaceDir, options.manifest.originalFilePath));
  }

  args.push(prompt);

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
  const output = validateCodexAuditOutput(parsed, options.manifest);

  return {
    output,
    model: options.model ?? null,
  };
}
