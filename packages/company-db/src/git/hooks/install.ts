import { writeFile, chmod, mkdir } from "fs/promises";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

function resolveDefaultDistDir(): string {
  let currentDir = dirname(fileURLToPath(import.meta.url));

  while (basename(currentDir) !== "dist") {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  if (basename(currentDir) === "dist") {
    return currentDir;
  }

  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");
}

/**
 * Install git hooks that delegate to compiled JS files.
 *
 * Writes shell scripts to `.git/hooks/pre-commit` and `.git/hooks/post-commit`
 * that invoke node with the compiled hook JS.
 *
 * @param repoPath - Root path of the git repository
 * @param distDir - Path to the compiled dist directory containing hook JS files.
 *                  Defaults to `node_modules/@corpus/company-db/dist`.
 */
export async function installHooks(
  repoPath: string,
  distDir?: string
): Promise<void> {
  const hooksDir = join(repoPath, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });

  const resolvedDistDir =
    distDir ??
    process.env.COMPANY_DB_HOOKS_DIST_DIR?.trim() ??
    resolveDefaultDistDir();

  // Pre-commit hook
  const preCommitScript = [
    "#!/bin/sh",
    `node "${join(resolvedDistDir, "git", "hooks", "pre-commit.js")}"`,
    "",
  ].join("\n");

  const preCommitPath = join(hooksDir, "pre-commit");
  await writeFile(preCommitPath, preCommitScript, "utf-8");
  await chmod(preCommitPath, 0o755);

  // Post-commit hook
  const postCommitScript = [
    "#!/bin/sh",
    `node "${join(resolvedDistDir, "git", "hooks", "post-commit.js")}"`,
    "",
  ].join("\n");

  const postCommitPath = join(hooksDir, "post-commit");
  await writeFile(postCommitPath, postCommitScript, "utf-8");
  await chmod(postCommitPath, 0o755);
}
