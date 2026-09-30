import type { ExecFileOptions } from "child_process";

export const PYTHON_BRIDGE_MAX_BUFFER_BYTES = 1024 * 1024 * 5;

export function readBoundedIntEnv(
  name: string,
  defaultValue: number,
  minValue: number,
  maxValue: number,
): number {
  const raw = process.env[name];
  if (!raw?.trim()) return defaultValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(maxValue, Math.max(minValue, Math.trunc(parsed)));
}

export function buildPythonBridgeExecOptions(
  timeoutEnvName: string,
  defaultTimeoutMs: number,
): ExecFileOptions {
  return {
    encoding: "utf8",
    maxBuffer: PYTHON_BRIDGE_MAX_BUFFER_BYTES,
    timeout: readBoundedIntEnv(
      timeoutEnvName,
      defaultTimeoutMs,
      5_000,
      300_000,
    ),
    killSignal: "SIGKILL",
  };
}
