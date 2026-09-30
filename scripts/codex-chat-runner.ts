#!/usr/bin/env node

import { appendFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';

import { eq } from 'drizzle-orm';

import { listConnections } from '@/lib/connections';
import { extractMessageText, normalizeStoredMessages } from '@/lib/consultant/messages';
import { syncNormalizedThreadMessages } from '@/lib/consultant/store';
import { getCompanyDescription } from '@/lib/company-settings';
import {
  createCodexChatEphemeralAgentKey,
  revokeCodexChatEphemeralAgentKey,
} from '@/lib/codex-chat/agent-access';
import { syncCodexChatThreadArtifacts } from '@/lib/codex-chat/artifacts';
import { checkCodexAuthReady } from '@/lib/codex-worker/auth';
import { getCodexChatAuthProfileById, readCodexChatApiKey } from '@/lib/codex-chat/auth-store';
import {
  buildCodexChatAgentEnv,
  buildCodexChatAuthEnv,
  ensureCodexChatProfileHomePath,
} from '@/lib/codex-chat/env';
import { buildCodexChatPrompt } from '@/lib/codex-chat/prompt';
import { runCodexChat } from '@/lib/codex-chat/run-codex-chat';
import { CODEX_CHAT_EXECUTOR } from '@/lib/codex-chat/types';
import { ensureCodexChatThreadWorkspace } from '@/lib/codex-chat/workspace';
import { db } from '@/lib/db';
import { chatRuns, chatThreads, codexChatAuthProfiles, companies } from '@/lib/db/schema';

interface RunnerArgs {
  runId: string | null;
}

function parseArgs(argv: string[]): RunnerArgs {
  let runId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--run-id') {
      runId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (current.startsWith('--run-id=')) {
      runId = current.slice('--run-id='.length) || null;
    }
  }
  return { runId };
}

function assertRunId(runId: string | null): string {
  if (!runId) {
    throw new Error('Usage: tsx scripts/codex-chat-runner.ts --run-id <uuid>');
  }
  return runId;
}

function latestUserPrompt(messages: ReturnType<typeof normalizeStoredMessages>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const text = extractMessageText(message.parts).trim();
    if (text) return text;
  }
  return '';
}

async function appendSessionNote(workspaceRoot: string, note: string): Promise<void> {
  await appendFile(join(workspaceRoot, 'SESSION.md'), `\n- ${new Date().toISOString()} ${note}\n`, 'utf8').catch(() => undefined);
}

async function failRun(input: {
  runId: string;
  threadId: string;
  metadata: Record<string, unknown>;
  error: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(chatRuns)
      .set({
        status: 'failed',
        completedAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          ...(input.metadata ?? {}),
          error: input.error,
        },
      })
      .where(eq(chatRuns.id, input.runId));

    const [thread] = await tx
      .select({ runtimeMetadata: chatThreads.runtimeMetadata })
      .from(chatThreads)
      .where(eq(chatThreads.id, input.threadId))
      .limit(1);

    await tx
      .update(chatThreads)
      .set({
        updatedAt: new Date(),
        runtimeMetadata: {
          ...(thread?.runtimeMetadata ?? {}),
          lastRunStatus: 'failed',
          lastRunError: input.error,
          lastRunCompletedAt: new Date().toISOString(),
        },
      })
      .where(eq(chatThreads.id, input.threadId));
  });
}

async function main(): Promise<void> {
  const runId = assertRunId(parseArgs(process.argv.slice(2)).runId);

  const [runRow] = await db
    .select({
      id: chatRuns.id,
      threadId: chatRuns.threadId,
      companyId: chatRuns.companyId,
      model: chatRuns.model,
      status: chatRuns.status,
      metadata: chatRuns.metadata,
      threadTitle: chatThreads.title,
      threadMessages: chatThreads.messages,
      threadWorkspaceRoot: chatThreads.workspaceRoot,
      threadRuntimeMetadata: chatThreads.runtimeMetadata,
      threadExecutor: chatThreads.executor,
      threadAuthProfileId: chatThreads.authProfileId,
      threadUpdatedAt: chatThreads.updatedAt,
      threadCreatedAt: chatThreads.createdAt,
      companyName: companies.name,
      companySlug: companies.slug,
      companySettings: companies.settings,
      profileHomePath: codexChatAuthProfiles.codexHomePath,
      profileId: codexChatAuthProfiles.id,
      userId: codexChatAuthProfiles.userId,
    })
    .from(chatRuns)
    .innerJoin(chatThreads, eq(chatThreads.id, chatRuns.threadId))
    .innerJoin(companies, eq(companies.id, chatRuns.companyId))
    .innerJoin(codexChatAuthProfiles, eq(codexChatAuthProfiles.id, chatThreads.authProfileId))
    .where(eq(chatRuns.id, runId))
    .limit(1);

  if (!runRow) {
    throw new Error(`Codex chat run ${runId} not found.`);
  }

  if (runRow.threadExecutor !== CODEX_CHAT_EXECUTOR) {
    throw new Error(`Run ${runId} is not bound to codex_chat.`);
  }

  if (runRow.status === 'completed' || runRow.status === 'failed') {
    return;
  }

  const workspaceRoot = runRow.threadWorkspaceRoot?.trim();
  if (!workspaceRoot) {
    await failRun({
      runId,
      threadId: runRow.threadId,
      metadata: runRow.metadata ?? {},
      error: 'Codex thread workspace is missing.',
    });
    return;
  }

  await ensureCodexChatThreadWorkspace({
    companyId: runRow.companyId,
    userId: runRow.userId,
    threadId: runRow.threadId,
    title: runRow.threadTitle,
    authProfileId: runRow.profileId,
    createdAt: runRow.threadCreatedAt,
    updatedAt: runRow.threadUpdatedAt,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(chatRuns)
      .set({
        status: 'running',
        startedAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          ...(runRow.metadata ?? {}),
          workspaceRoot,
        },
      })
      .where(eq(chatRuns.id, runId));

    await tx
      .update(chatThreads)
      .set({
        updatedAt: new Date(),
        runtimeMetadata: {
          ...(runRow.threadRuntimeMetadata ?? {}),
          lastRunStatus: 'running',
          lastRunStartedAt: new Date().toISOString(),
          lastRunError: null,
        },
      })
      .where(eq(chatThreads.id, runRow.threadId));
  });

  const profile = await getCodexChatAuthProfileById({
    companyId: runRow.companyId,
    userId: runRow.userId,
    profileId: runRow.profileId,
  });

  if (!profile || profile.status !== 'ready') {
    await failRun({
      runId,
      threadId: runRow.threadId,
      metadata: runRow.metadata ?? {},
      error: 'Codex auth profile is not ready.',
    });
    return;
  }

  const apiKey = profile.authMode === 'api_key'
    ? await readCodexChatApiKey(profile.id)
    : null;

  const codexHomePath = await ensureCodexChatProfileHomePath({
    companyId: runRow.companyId,
    userId: runRow.userId,
    profileId: profile.id,
  });

  const codexEnv = buildCodexChatAuthEnv({
    companyId: runRow.companyId,
    userId: runRow.userId,
      profileId: profile.id,
      authMode: profile.authMode,
      apiKey,
      codexHomePath: runRow.profileHomePath ?? codexHomePath,
    });

  const authReady = await checkCodexAuthReady({
    codexBin: process.env.CODEX_BIN ?? 'codex',
    env: codexEnv,
  });

  if (!authReady.ready) {
    await failRun({
      runId,
      threadId: runRow.threadId,
      metadata: {
        ...(runRow.metadata ?? {}),
        authMode: profile.authMode,
      },
      error: authReady.reason,
    });
    return;
  }

  const history = normalizeStoredMessages(runRow.threadMessages);
  const connectors = await listConnections(runRow.companyId).catch(() => []);
  let agentKey: Awaited<ReturnType<typeof createCodexChatEphemeralAgentKey>> | null = null;

  try {
    agentKey = await createCodexChatEphemeralAgentKey({
      runId,
      threadId: runRow.threadId,
      companyId: runRow.companyId,
      userId: runRow.userId,
    });

    const prompt = buildCodexChatPrompt({
      companyName: runRow.companyName,
      companySlug: runRow.companySlug ?? runRow.companyId,
      userRole: 'company_user',
      threadTitle: runRow.threadTitle,
      latestUserPrompt: latestUserPrompt(history),
      repoRoot: process.cwd(),
      workspaceRoot,
      companyDescription: getCompanyDescription(runRow.companySettings),
      connectedServices: connectors.map((connection) => connection.provider),
      history,
      toolBridgeCommand: './bin/corpus-agent',
    });

    await writeFile(join(workspaceRoot, 'COMPANY_CONTEXT.md'), `${prompt}\n`, 'utf8');
    await appendSessionNote(workspaceRoot, `starting run ${runId}`);

    const startedAt = Date.now();
    const result = await runCodexChat({
      workspaceDir: workspaceRoot,
      prompt,
      model: runRow.model,
      env: {
        ...codexEnv,
        ...buildCodexChatAgentEnv({
          appUrl: agentKey.appUrl,
          apiKey: agentKey.plaintext,
          companyId: agentKey.companyId,
        }),
      },
    });

    const assistantText = result.assistantText.trim();
    if (!assistantText) {
      throw new Error('Codex returned an empty final message.');
    }

    const assistantMessage = {
      id: randomUUID(),
      role: 'assistant' as const,
      parts: [{ type: 'text', text: assistantText }],
    };
    const nextMessages = [...history, assistantMessage];
    const durationMs = Date.now() - startedAt;

    await db.transaction(async (tx) => {
      await tx
        .update(chatThreads)
        .set({
          messages: nextMessages as Array<Record<string, unknown>>,
          updatedAt: new Date(),
          runtimeMetadata: {
            ...(runRow.threadRuntimeMetadata ?? {}),
            lastRunStatus: 'completed',
            lastRunCompletedAt: new Date().toISOString(),
            lastRunError: null,
            lastRunDurationMs: durationMs,
            lastAssistantMessageId: assistantMessage.id,
          },
        })
        .where(eq(chatThreads.id, runRow.threadId));

      await syncNormalizedThreadMessages(tx, {
        threadId: runRow.threadId,
        companyId: runRow.companyId,
        userId: runRow.userId,
        messages: nextMessages,
      });

      await syncCodexChatThreadArtifacts({
        companyId: runRow.companyId,
        userId: runRow.userId,
        threadId: runRow.threadId,
        uiMessageId: assistantMessage.id,
        executor: tx,
      });

      await tx
        .update(chatRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
          summary: assistantText.replace(/\s+/g, ' ').slice(0, 280),
          metadata: {
            ...(runRow.metadata ?? {}),
            authMode: profile.authMode,
            durationMs,
            workspaceRoot,
            agentToolBridge: true,
            stdout: result.stdout.slice(-4000),
            stderr: result.stderr.slice(-4000),
            assistantMessageId: assistantMessage.id,
          },
        })
        .where(eq(chatRuns.id, runId));
    });

    await appendSessionNote(workspaceRoot, `completed run ${runId} in ${durationMs}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Codex chat run failed.';
    await appendSessionNote(workspaceRoot, `failed run ${runId}: ${message}`);
    await failRun({
      runId,
      threadId: runRow.threadId,
      metadata: {
        ...(runRow.metadata ?? {}),
        authMode: profile.authMode,
        workspaceRoot,
        agentToolBridge: true,
      },
      error: message,
    });
  } finally {
    if (!agentKey) return;
    const agentKeyId = agentKey.id;
    await revokeCodexChatEphemeralAgentKey(agentKeyId).catch((error) => {
      console.error(`Failed to revoke Codex chat agent key ${agentKeyId}:`, error);
    });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
