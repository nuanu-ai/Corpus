import { access, mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";

const DEFAULT_CONSULTANT_WORKSPACE_ROOT = resolve(
  /* turbopackIgnore: true */
  process.env.CONSULTANT_WORKSPACE_DIR ?? join(tmpdir(), "corpus-consultant-workspaces"),
);

export interface EnsureConsultantWorkspaceInput {
  companyId: string;
  threadId: string;
  userId: string;
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface WorkspaceManifest {
  version: number;
  companyId: string;
  threadId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

type ConsultantWorkspaceDestination = "artifacts" | "proposals" | "exports";

export function getConsultantWorkspaceRoot(): string {
  return DEFAULT_CONSULTANT_WORKSPACE_ROOT;
}

export function getConsultantThreadWorkspacePath(companyId: string, threadId: string): string {
  return resolveArtifactPath(getConsultantWorkspaceRoot(), join(companyId, threadId));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artifact";
}

function validateArtifactFileName(fileName: string): string {
  const normalized = fileName.trim();
  if (!normalized) {
    throw new Error("Artifact file name cannot be empty");
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    throw new Error("Artifact file name must not contain path separators or traversal segments");
  }
  return normalized;
}

function resolveArtifactPath(rootPath: string, relativePath: string): string {
  const fullPath = resolve(rootPath, relativePath);

  const pathFromRoot = relative(rootPath, fullPath);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Artifact path escapes consultant workspace");
  }

  return fullPath;
}

function resolveDestinationRoot(
  rootPath: string,
  destination: ConsultantWorkspaceDestination,
): string {
  switch (destination) {
    case "artifacts":
      return join(rootPath, "artifacts");
    case "proposals":
      return join(rootPath, "proposals");
    case "exports":
      return join(rootPath, "exports");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await exists(path)) return;
  await writeFile(path, content, "utf8");
}

function buildWorkspaceManifest(input: EnsureConsultantWorkspaceInput): WorkspaceManifest {
  const createdAt = input.createdAt ?? new Date();
  const updatedAt = input.updatedAt ?? createdAt;

  return {
    version: 1,
    companyId: input.companyId,
    threadId: input.threadId,
    userId: input.userId,
    title: input.title,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export async function ensureConsultantThreadWorkspace(
  input: EnsureConsultantWorkspaceInput,
): Promise<{ rootPath: string; manifestPath: string }> {
  const rootPath = getConsultantThreadWorkspacePath(input.companyId, input.threadId);
  const artifactsPath = join(rootPath, "artifacts");
  const exportsPath = join(rootPath, "exports");
  const proposalsPath = join(rootPath, "proposals");
  const manifestPath = join(rootPath, "thread.json");

  await mkdir(rootPath, { recursive: true });
  await mkdir(artifactsPath, { recursive: true });
  await mkdir(exportsPath, { recursive: true });
  await mkdir(proposalsPath, { recursive: true });

  await writeIfMissing(
    join(rootPath, "PLAN.md"),
    [
      "# Plan",
      "",
      "- Objective:",
      "- Constraints:",
      "- Current status:",
      "- Next actions:",
      "",
    ].join("\n"),
  );
  await writeIfMissing(
    join(rootPath, "MEMORY.md"),
    [
      "# Memory",
      "",
      "Durable facts, preferences, and context snapshots for this thread live here.",
      "",
    ].join("\n"),
  );
  await writeIfMissing(
    join(rootPath, "DECISIONS.md"),
    [
      "# Decisions",
      "",
      "Important decisions, approvals, and disagreements are logged here.",
      "",
    ].join("\n"),
  );
  await writeIfMissing(
    join(artifactsPath, "README.md"),
    [
      "# Artifacts",
      "",
      "Generated drafts, reports, spreadsheets, and previews are stored in this folder.",
      "",
    ].join("\n"),
  );
  await writeIfMissing(
    join(proposalsPath, "README.md"),
    [
      "# Proposals",
      "",
      "Files prepared for Company-DB or other confirmed actions should land here before approval.",
      "",
    ].join("\n"),
  );

  await writeFile(
    manifestPath,
    `${JSON.stringify(buildWorkspaceManifest(input), null, 2)}\n`,
    "utf8",
  );

  return { rootPath, manifestPath };
}

export async function writeConsultantArtifactFile(input: {
  companyId: string;
  threadId: string;
  title: string;
  content: string;
  fileName?: string;
  destination?: ConsultantWorkspaceDestination;
}): Promise<{ fullPath: string; relativePath: string; rootPath: string }> {
  const rootPath = getConsultantThreadWorkspacePath(input.companyId, input.threadId);
  const destination = input.destination ?? "artifacts";
  const destinationRoot = resolveDestinationRoot(rootPath, destination);
  const fileName = input.fileName?.trim()
    ? validateArtifactFileName(input.fileName)
    : `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(input.title)}.md`;
  const fullPath = resolveArtifactPath(destinationRoot, fileName);

  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, input.content, "utf8");

  return {
    fullPath,
    relativePath: relative(rootPath, fullPath),
    rootPath,
  };
}

export async function writeConsultantArtifactBinaryFile(input: {
  companyId: string;
  threadId: string;
  title: string;
  content: Buffer;
  fileName?: string;
  destination?: ConsultantWorkspaceDestination;
}): Promise<{ fullPath: string; relativePath: string; rootPath: string }> {
  const rootPath = getConsultantThreadWorkspacePath(input.companyId, input.threadId);
  const destination = input.destination ?? "artifacts";
  const destinationRoot = resolveDestinationRoot(rootPath, destination);
  const fileName = input.fileName?.trim()
    ? validateArtifactFileName(input.fileName)
    : `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(input.title)}.bin`;
  const fullPath = resolveArtifactPath(destinationRoot, fileName);

  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, input.content);

  return {
    fullPath,
    relativePath: relative(rootPath, fullPath),
    rootPath,
  };
}

export async function readConsultantArtifactFile(input: {
  companyId: string;
  threadId: string;
  relativePath: string;
}): Promise<{ content: string; fullPath: string; rootPath: string }> {
  const rootPath = getConsultantThreadWorkspacePath(input.companyId, input.threadId);
  const fullPath = resolveArtifactPath(rootPath, input.relativePath);
  const content = await readFile(fullPath, "utf8");
  return {
    content,
    fullPath,
    rootPath,
  };
}

export async function readConsultantArtifactData(input: {
  companyId: string;
  threadId: string;
  relativePath: string;
}): Promise<{ content: Buffer; fullPath: string; rootPath: string }> {
  const rootPath = getConsultantThreadWorkspacePath(input.companyId, input.threadId);
  const fullPath = resolveArtifactPath(rootPath, input.relativePath);
  const content = await readFile(fullPath);
  return {
    content,
    fullPath,
    rootPath,
  };
}
