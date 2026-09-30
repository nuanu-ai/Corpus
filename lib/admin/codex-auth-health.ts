import { checkCodexAuthReady } from "@/lib/codex-worker/auth";
import {
  buildCodexChatGptSlotEnv,
  getCodexChatGptSlots,
} from "@/lib/codex-worker/chatgpt-slots";
import {
  isPersistedCodexAuthFailureActive,
  readPersistedCodexAuthHealth,
} from "@/lib/codex-worker/health";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildCodexAuthEnv(mode: "chatgpt" | "api_key", env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...env,
    CODEX_AUTH_MODE: mode === "chatgpt"
      ? env.CODEX_AUTH_MODE_CHATGPT ?? "chatgpt"
      : env.CODEX_AUTH_MODE_API_KEY ?? "api_key",
    CODEX_HOME:
      mode === "chatgpt"
        ? env.CODEX_HOME_CHATGPT ?? env.CODEX_HOME
        : env.CODEX_HOME_API_KEY ?? env.CODEX_HOME,
  };

  if (mode === "api_key") {
    const key = env.CODEX_OPENAI_API_KEY ?? env.OPENAI_API_KEY;
    if (key) {
      base.CODEX_OPENAI_API_KEY = key;
      base.OPENAI_API_KEY = key;
    }
  } else {
    delete base.OPENAI_API_KEY;
  }

  return base;
}

export async function getCodexAuthHealth(env: NodeJS.ProcessEnv = process.env) {
  const chatgptRequestedWorkers = parsePositiveInt(
    env.CODEX_WORKER_INSTANCES_CHATGPT ?? env.CODEX_WORKER_INSTANCES,
    4,
  );
  const apiKeyRequestedWorkers = parsePositiveInt(env.CODEX_WORKER_INSTANCES_API_KEY, 0);
  const chatgptAuthMode = env.CODEX_AUTH_MODE_CHATGPT ?? "chatgpt";
  const codexBin = env.CODEX_BIN ?? "codex";

  if (chatgptAuthMode === "chatgpt" && chatgptRequestedWorkers > 0) {
    const slotChecks = await Promise.all(
      getCodexChatGptSlots(env).map(async (slot) => {
        const slotEnv = buildCodexChatGptSlotEnv(slot.slotIndex, env);
        const [readiness, persistedHealth] = await Promise.all([
          checkCodexAuthReady({
            codexBin,
            env: slotEnv,
          }),
          readPersistedCodexAuthHealth("chatgpt", slotEnv),
        ]);
        const failureActive = await isPersistedCodexAuthFailureActive(
          "chatgpt",
          slotEnv,
          persistedHealth,
        );
        const activeFailure = failureActive ? persistedHealth : null;
        return {
          slotId: slot.slotId,
          slotIndex: slot.slotIndex,
          codeHome: slot.codeHome,
          ready: readiness.ready && !activeFailure,
          reason:
            activeFailure?.activeFailureReason ??
            (readiness.ready ? null : readiness.reason),
          lastReadyAt: persistedHealth?.lastReadyAt ?? null,
          lastFailureAt: persistedHealth?.lastFailureAt ?? null,
        };
      }),
    );

    const [apiKeyReadiness, persistedApiKeyHealth] = await Promise.all([
      checkCodexAuthReady({
        codexBin,
        env: buildCodexAuthEnv("api_key", env),
      }),
      readPersistedCodexAuthHealth("api_key", env),
    ]);
    const apiKeyFailureActive = await isPersistedCodexAuthFailureActive(
      "api_key",
      env,
      persistedApiKeyHealth,
    );
    const apiKeyActiveFailure = apiKeyFailureActive ? persistedApiKeyHealth : null;

    const readySlots = slotChecks.filter((slot) => slot.ready).length;
    const degraded = readySlots > 0 && readySlots < slotChecks.length;
    const nextReason =
      readySlots === 0
        ? slotChecks.find((slot) => slot.reason)?.reason ?? "No ChatGPT auth slot is ready."
        : degraded
          ? `${slotChecks.length - readySlots} ChatGPT auth slots still need login or repair.`
          : null;

    return {
      chatgpt: {
        requestedWorkers: chatgptRequestedWorkers,
        effectiveWorkers: readySlots,
        configuredSlots: slotChecks.length,
        readySlots,
        degraded,
        authMode: chatgptAuthMode,
        codeHome: slotChecks[0]?.codeHome ?? env.CODEX_HOME_CHATGPT ?? env.CODEX_HOME ?? null,
        ready: readySlots > 0,
        reason: nextReason,
        unsafeSharedToken: false,
        lastReadyAt:
          slotChecks
            .map((slot) => slot.lastReadyAt)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) ?? null,
        lastFailureAt:
          slotChecks
            .map((slot) => slot.lastFailureAt)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) ?? null,
        slots: slotChecks,
      },
      apiKey: {
        requestedWorkers: apiKeyRequestedWorkers,
        authMode: env.CODEX_AUTH_MODE_API_KEY ?? "api_key",
        codeHome: env.CODEX_HOME_API_KEY ?? null,
        ready: apiKeyReadiness.ready && !apiKeyActiveFailure,
        reason:
          apiKeyActiveFailure?.activeFailureReason ??
          (apiKeyReadiness.ready ? null : apiKeyReadiness.reason),
        lastReadyAt: persistedApiKeyHealth?.lastReadyAt ?? null,
        lastFailureAt: persistedApiKeyHealth?.lastFailureAt ?? null,
      },
    };
  }

  const [chatgptReadiness, apiKeyReadiness, persistedChatgptHealth, persistedApiKeyHealth] = await Promise.all([
    checkCodexAuthReady({
      codexBin,
      env: buildCodexAuthEnv("chatgpt", env),
    }),
    checkCodexAuthReady({
      codexBin,
      env: buildCodexAuthEnv("api_key", env),
    }),
    readPersistedCodexAuthHealth("chatgpt", env),
    readPersistedCodexAuthHealth("api_key", env),
  ]);

  const chatgptUnsafeSharedToken =
    chatgptAuthMode === "chatgpt" && chatgptRequestedWorkers > 1;

  const [chatgptFailureActive, apiKeyFailureActive] = await Promise.all([
    isPersistedCodexAuthFailureActive("chatgpt", env, persistedChatgptHealth),
    isPersistedCodexAuthFailureActive("api_key", env, persistedApiKeyHealth),
  ]);
  const chatgptActiveFailure = chatgptFailureActive ? persistedChatgptHealth : null;
  const apiKeyActiveFailure = apiKeyFailureActive ? persistedApiKeyHealth : null;

  return {
    chatgpt: {
      requestedWorkers: chatgptRequestedWorkers,
      effectiveWorkers: chatgptRequestedWorkers,
      configuredSlots: 0,
      readySlots: chatgptReadiness.ready && !chatgptActiveFailure ? chatgptRequestedWorkers : 0,
      degraded: false,
      authMode: chatgptAuthMode,
      codeHome: env.CODEX_HOME_CHATGPT ?? env.CODEX_HOME ?? null,
      ready: chatgptReadiness.ready && !chatgptActiveFailure,
      reason: chatgptActiveFailure?.activeFailureReason ?? (chatgptReadiness.ready ? null : chatgptReadiness.reason),
      unsafeSharedToken: chatgptUnsafeSharedToken,
      lastReadyAt: persistedChatgptHealth?.lastReadyAt ?? null,
      lastFailureAt: persistedChatgptHealth?.lastFailureAt ?? null,
      slots: [],
    },
    apiKey: {
      requestedWorkers: apiKeyRequestedWorkers,
      authMode: env.CODEX_AUTH_MODE_API_KEY ?? "api_key",
      codeHome: env.CODEX_HOME_API_KEY ?? null,
      ready: apiKeyReadiness.ready && !apiKeyActiveFailure,
      reason: apiKeyActiveFailure?.activeFailureReason ?? (apiKeyReadiness.ready ? null : apiKeyReadiness.reason),
      lastReadyAt: persistedApiKeyHealth?.lastReadyAt ?? null,
      lastFailureAt: persistedApiKeyHealth?.lastFailureAt ?? null,
    },
  };
}
