import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';

import { buildCodexCliEnv } from '@/lib/codex-worker/auth';
import { buildCodexSubprocessEnv, resolveCodexExecTimeoutMs } from '@/lib/codex-worker/run-codex';

const execFileAsync = promisify(execFile);

export interface RunCodexChatOptions {
  workspaceDir: string;
  prompt: string;
  model?: string | null;
  codexBin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export async function runCodexChat(options: RunCodexChatOptions): Promise<{
  assistantText: string;
  stdout: string;
  stderr: string;
}> {
  const codexBin = options.codexBin ?? process.env.CODEX_BIN ?? 'codex';
  const runtimeDir = join(options.workspaceDir, '.codex-chat');
  const promptPath = join(runtimeDir, 'prompt.txt');
  const outputPath = join(runtimeDir, 'last-message.txt');
  const execTimeout = resolveCodexExecTimeoutMs('default', options.timeoutMs, process.env);

  await mkdir(dirname(promptPath), { recursive: true });
  await writeFile(promptPath, options.prompt, 'utf8');

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '--ephemeral',
    '-c',
    'shell_environment_policy.inherit=all',
    '--color',
    'never',
    '--output-last-message',
    outputPath,
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  args.push(options.prompt);

  const result = await execFileAsync(codexBin, args, {
    cwd: options.workspaceDir,
    maxBuffer: 1024 * 1024 * 20,
    timeout: execTimeout,
    killSignal: 'SIGTERM',
    env: {
      ...buildCodexCliEnv(buildCodexSubprocessEnv(options.env ?? process.env)),
    },
  });

  const assistantText = (await readFile(outputPath, 'utf8')).trim();
  return {
    assistantText,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
