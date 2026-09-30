import { createHash } from "node:crypto";

import { ensureCompanyProvisioned } from "@/lib/company-db/provisioning";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { submitCompanyDbCommit } from "@/lib/company-db/client";
import { toQmd } from "@/lib/company-db/summary/qmd";

const MAX_PROJECT_NAME_LENGTH = 160;
const MAX_PROJECT_DESCRIPTION_LENGTH = 4_000;

export type CompanyDbProjectStatus = "planned" | "active" | "completed" | "on_hold";

export type CreateCompanyDbProjectInput = {
  companyId: string;
  companyDbPort: number;
  userId: string;
  name: string;
  description?: string | null;
  status?: CompanyDbProjectStatus | null;
  source?: string | null;
  telegram?: {
    telegramUserId: string;
    telegramChatId: string;
    telegramMessageId?: number | string | null;
  } | null;
};

export type CreateCompanyDbProjectResult = {
  projectId: string;
  name: string;
  status: CompanyDbProjectStatus;
  filePath: string;
  commitSha: string | null;
  companySlug: string;
};

function slugify(value: string, fallback = "project") {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function normalizeProjectName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("Project name is required");
  }
  if (normalized.length > MAX_PROJECT_NAME_LENGTH) {
    throw new Error(`Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`);
  }
  return normalized;
}

function normalizeProjectDescription(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_PROJECT_DESCRIPTION_LENGTH);
}

function normalizeProjectStatus(value: CompanyDbProjectStatus | null | undefined) {
  return value ?? "active";
}

export function parseTelegramProjectSpec(text: string): {
  name: string;
  description: string | null;
} {
  const [namePart, ...descriptionParts] = text.split("|");
  return {
    name: normalizeProjectName(namePart ?? ""),
    description: normalizeProjectDescription(descriptionParts.join("|")),
  };
}

export async function createCompanyDbProjectRecord(
  input: CreateCompanyDbProjectInput,
): Promise<CreateCompanyDbProjectResult> {
  const name = normalizeProjectName(input.name);
  const description = normalizeProjectDescription(input.description);
  const status = normalizeProjectStatus(input.status);
  const projectSlug = slugify(name);
  const projectId = `project-${projectSlug}-${shortHash(`${input.companyId}:${projectSlug}`)}`;
  const filePath = `projects/portfolio/${projectSlug}.qmd`;
  const now = new Date().toISOString();

  await ensureCompanyProvisioned(input.companyId);
  const companySlug = await getCompanySlug(input.companyId);

  const frontmatter: Record<string, unknown> = {
    id: projectId,
    type: "project",
    name,
    status,
    source: input.source ?? "telegram_bot",
    created_by_user_id: input.userId,
    created_at: now,
    updated_at: now,
  };

  if (description) {
    frontmatter.description = description;
  }
  if (input.telegram) {
    frontmatter.telegram = {
      user_id: input.telegram.telegramUserId,
      chat_id: input.telegram.telegramChatId,
      message_id: input.telegram.telegramMessageId ?? null,
    };
  }

  const body = description
    ? `# ${name}\n\n${description}\n`
    : `# ${name}\n\nProject created from Telegram bot.\n`;

  const commit = await submitCompanyDbCommit(
    companySlug,
    {
      domain: "projects",
      filePath,
      content: toQmd(frontmatter, body),
      commitMessage: `projects: create ${name}`,
      metadata: {
        source: input.source ?? "telegram_bot",
        projectId,
        projectName: name,
        filePath,
      },
    },
    input.companyDbPort + 1,
  );

  return {
    projectId,
    name,
    status,
    filePath,
    commitSha: commit.commitSha,
    companySlug,
  };
}
