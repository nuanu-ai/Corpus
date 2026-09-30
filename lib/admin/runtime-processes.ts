import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RuntimeProcessKeyExposureGroup {
  group: string;
  processCount: number;
  anthropic: boolean;
  openai: boolean;
  codex: boolean;
  sampleNames: string[];
}

export interface RuntimeProcessKeyExposureSummary {
  available: boolean;
  groups: RuntimeProcessKeyExposureGroup[];
  anthropicProcessCount: number;
  openAiProcessCount: number;
  codexProcessCount: number;
}

function classifyProcessName(name: string): string {
  if (name.startsWith("company-db-")) return "company-db-tenant";
  if (name === "company-db") return "company-db";
  if (name === "codex-worker") return "codex-worker";
  if (name === "codex-worker-apikey") return "codex-worker-apikey";
  if (name === "nextjs") return "nextjs";
  if (name === "inngest") return "inngest";
  return name;
}

function hasEnvValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function getRuntimeProcessKeyExposure(): Promise<RuntimeProcessKeyExposureSummary> {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], {
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || "[]");
    if (!Array.isArray(parsed)) {
      return {
        available: false,
        groups: [],
        anthropicProcessCount: 0,
        openAiProcessCount: 0,
        codexProcessCount: 0,
      };
    }

    const grouped = new Map<string, RuntimeProcessKeyExposureGroup>();

    for (const proc of parsed) {
      const name = typeof proc?.name === "string" ? proc.name : "unknown";
      const env = proc?.pm2_env?.env && typeof proc.pm2_env.env === "object"
        ? (proc.pm2_env.env as Record<string, unknown>)
        : {};
      const groupKey = classifyProcessName(name);
      const current = grouped.get(groupKey) ?? {
        group: groupKey,
        processCount: 0,
        anthropic: false,
        openai: false,
        codex: false,
        sampleNames: [],
      };

      current.processCount += 1;
      current.anthropic = current.anthropic || hasEnvValue(env.ANTHROPIC_API_KEY);
      current.openai = current.openai || hasEnvValue(env.OPENAI_API_KEY);
      current.codex = current.codex || hasEnvValue(env.CODEX_OPENAI_API_KEY);
      if (current.sampleNames.length < 5 && !current.sampleNames.includes(name)) {
        current.sampleNames.push(name);
      }
      grouped.set(groupKey, current);
    }

    const groups = [...grouped.values()].sort((left, right) => {
      if (right.processCount !== left.processCount) return right.processCount - left.processCount;
      return left.group.localeCompare(right.group);
    });

    return {
      available: true,
      groups,
      anthropicProcessCount: groups.reduce((sum, row) => sum + (row.anthropic ? row.processCount : 0), 0),
      openAiProcessCount: groups.reduce((sum, row) => sum + (row.openai ? row.processCount : 0), 0),
      codexProcessCount: groups.reduce((sum, row) => sum + (row.codex ? row.processCount : 0), 0),
    };
  } catch {
    return {
      available: false,
      groups: [],
      anthropicProcessCount: 0,
      openAiProcessCount: 0,
      codexProcessCount: 0,
    };
  }
}
