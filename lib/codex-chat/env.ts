import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import type { CodexChatAuthMode } from './types';

const DEFAULT_CODEX_CHAT_AUTH_ROOT = resolve(
  /* turbopackIgnore: true */
  process.env.CODEX_CHAT_AUTH_DIR ?? join(tmpdir(), 'corpus-codex-chat-auth'),
);

export function getCodexChatAuthRoot(): string {
  return DEFAULT_CODEX_CHAT_AUTH_ROOT;
}

export function getCodexChatProfileHomePath(input: {
  companyId: string;
  userId: string;
  profileId: string;
}): string {
  return resolve(getCodexChatAuthRoot(), input.companyId, input.userId, input.profileId, 'codex-home');
}

export async function ensureCodexChatProfileHomePath(input: {
  companyId: string;
  userId: string;
  profileId: string;
}): Promise<string> {
  const path = getCodexChatProfileHomePath(input);
  await mkdir(path, { recursive: true });
  return path;
}

export function buildCodexChatAuthEnv(input: {
  companyId: string;
  userId: string;
  profileId: string;
  authMode: CodexChatAuthMode;
  apiKey?: string | null;
  codexHomePath?: string | null;
  env?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const baseEnv = { ...(input.env ?? process.env) };
  const codexHome = input.codexHomePath?.trim() || getCodexChatProfileHomePath(input);

  const nextEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    CODEX_HOME: codexHome,
    CODEX_AUTH_MODE: input.authMode === 'chatgpt_login' ? 'chatgpt' : 'api_key',
  };

  if (input.authMode === 'api_key') {
    const trimmedKey = input.apiKey?.trim();
    if (!trimmedKey) {
      throw new Error('Codex chat API key is required for api_key auth.');
    }
    nextEnv.OPENAI_API_KEY = trimmedKey;
    nextEnv.CODEX_OPENAI_API_KEY = trimmedKey;
  } else {
    delete nextEnv.OPENAI_API_KEY;
    delete nextEnv.CODEX_OPENAI_API_KEY;
  }

  return nextEnv;
}

export function buildCodexChatAgentEnv(input: {
  appUrl: string;
  apiKey: string;
  companyId: string;
  env?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const appUrl = input.appUrl.replace(/\/$/, "");
  return {
    ...(input.env ?? process.env),
    CORPUS_APP_URL: appUrl,
    CORPUS_API_KEY: input.apiKey,
    CORPUS_COMPANY_ID: input.companyId,
    CORPUS_AGENT_MCP_URL: `${appUrl}/api/agent/mcp`,
    CORPUS_AGENT_CONNECTORS_URL: `${appUrl}/api/agent/connectors`,
    CORPUS_AGENT_SESSION_URL: `${appUrl}/api/agent/session`,
  };
}
