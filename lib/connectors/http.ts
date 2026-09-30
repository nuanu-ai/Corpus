const DEFAULT_MAX_429_RETRY_AFTER_MS = 2_000;

function parseRetryAfterMs(headerValue: string | null, maxMs: number): number {
  if (!headerValue) return 0;
  const trimmed = headerValue.trim();
  if (!trimmed) return 0;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(maxMs, Math.round(seconds * 1000));
  }

  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) {
    return 0;
  }

  return Math.min(maxMs, Math.max(0, retryAt - Date.now()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return sleep(ms);
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("The operation was aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchWithTimeoutAndRetry(
  input: URL | string,
  init: RequestInit,
  options: {
    timeoutMs: number;
    maxRetriesOn429?: number;
    maxRetryAfterMs?: number;
  },
): Promise<Response> {
  const maxRetriesOn429 = Math.max(0, options.maxRetriesOn429 ?? 0);
  const maxRetryAfterMs = Math.max(0, options.maxRetryAfterMs ?? DEFAULT_MAX_429_RETRY_AFTER_MS);
  const callerSignal = init.signal ?? undefined;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const abortCaller = () => controller.abort();

    if (callerSignal) {
      if (callerSignal.aborted) {
        clearTimeout(timeout);
        throw new DOMException("The operation was aborted", "AbortError");
      }
      callerSignal.addEventListener("abort", abortCaller, { once: true });
    }

    try {
      const { signal: _signal, ...fetchInit } = init;
      const response = await fetch(input, {
        ...fetchInit,
        signal: controller.signal,
      });

      if (response.status === 429 && attempt < maxRetriesOn429) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get("Retry-After"),
          maxRetryAfterMs,
        );
        if (retryAfterMs > 0) {
          await sleepWithAbort(retryAfterMs, callerSignal);
        }
        continue;
      }

      return response;
    } finally {
      if (callerSignal) {
        callerSignal.removeEventListener("abort", abortCaller);
      }
      clearTimeout(timeout);
    }
  }
}
