#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function listPublishableFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

const forbiddenPathSegments = new Set([
  ".next",
  ".claude",
  "node_modules",
  "storage",
  "uploads",
  "backups",
  "exports",
]);

const forbiddenExtensions = new Set([
  ".bak",
  ".csv",
  ".db",
  ".doc",
  ".docx",
  ".dump",
  ".gz",
  ".key",
  ".p12",
  ".pfx",
  ".pdf",
  ".pem",
  ".rar",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".tgz",
  ".tsv",
  ".xls",
  ".xlsx",
  ".zip",
]);

const forbiddenMarkers = [
  ["legacy-brand-1", new RegExp(["nu", "anu"].join(""), "i")],
  ["legacy-brand-2", new RegExp(["mer", "curyo"].join(""), "i")],
  ["legacy-brand-3", new RegExp(["bedo", "guel"].join(""), "i")],
  ["legacy-product", new RegExp(["ai", "[-_ ]?", "cfo"].join(""), "i")],
  ["legacy-demo", new RegExp(["ac", "me"].join(""), "i")],
  ["legacy-client", new RegExp(["hospitality", "\\s+", "club"].join(""), "i")],
  ["renamed-payment-product", new RegExp(["corpus", "[ _-]?", "pay"].join(""), "i")],
];

const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["OpenAI-style token", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

const requiredFiles = [
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "docs/INDEX.md",
  "docs/architecture.md",
  "docs/architecture/agent-context-layer.md",
  "docs/architecture/chat-first-onboarding-agent.md",
  "docs/architecture/codex-chat-runtime-mte.md",
  "docs/architecture/document-pipeline-stability.md",
  "docs/configuration.md",
  "docs/security-model.md",
  "scripts/agent-mcp-cli.mjs",
  "scripts/codex-chat-device-login.ts",
  "scripts/codex-chat-runner.ts",
  "scripts/codex_extract_pdf.py",
];

const errors = [];
const files = listPublishableFiles();

for (const requiredFile of requiredFiles) {
  if (!existsSync(resolve(repoRoot, requiredFile))) {
    errors.push(`${requiredFile}: required public-release file is missing`);
  }
}

for (const file of files) {
  const absolutePath = resolve(repoRoot, file);
  if (!existsSync(absolutePath)) continue;

  const relativePath = relative(repoRoot, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    errors.push(`${file}: resolves outside the repository`);
    continue;
  }

  const segments = file.split(/[\\/]/);
  const forbiddenSegment = segments.find((segment) => forbiddenPathSegments.has(segment));
  if (forbiddenSegment) {
    errors.push(`${file}: forbidden generated or private path segment '${forbiddenSegment}'`);
  }

  const extension = extname(file).toLowerCase();
  if (forbiddenExtensions.has(extension)) {
    errors.push(`${file}: high-risk data or credential extension '${extension}'`);
  }

  if (/^\.env(?:\.|$)/i.test(file) && file !== ".env.example") {
    errors.push(`${file}: only .env.example may be published`);
  }

  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");

  // The public publisher is permitted only in the presentation and support files.
  // Keep legacy organization names forbidden throughout application code and data.
  const publisherFiles = new Set([
    "README.md",
    "docs/assets/corpus-banner.svg",
    ".github/ISSUE_TEMPLATE/config.yml",
  ]);
  const publisherSlug = ["nu", "anu-ai"].join("");
  const publisherName = ["Nu", "anu AI"].join("");
  const markerText = publisherFiles.has(file)
    ? text
      .replaceAll(`https://github.com/${publisherSlug}/Corpus`, "PUBLIC_REPOSITORY")
      .replaceAll(`https://github.com/${publisherSlug}`, "PUBLIC_PUBLISHER")
      .replaceAll(publisherName, "PUBLIC_PUBLISHER")
      .replaceAll(publisherName.toUpperCase(), "PUBLIC_PUBLISHER")
    : text;

  for (const [label, pattern] of forbiddenMarkers) {
    if (pattern.test(markerText)) errors.push(`${file}: contains ${label}`);
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) errors.push(`${file}: contains a possible ${label}`);
  }

  if (/[A-Z]:\\Users\\[^\\\s]+/i.test(text) || /\/(?:Users|home)\/[^/\s]+/.test(text)) {
    errors.push(`${file}: contains an absolute user-home path`);
  }
}

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
if (packageJson.name !== "corpus") errors.push("package.json: package name must be 'corpus'");
if (packageJson.license !== "Apache-2.0") errors.push("package.json: Apache-2.0 license metadata is required");

if (errors.length > 0) {
  console.error(`Public-release check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Public-release check passed for ${files.length} publishable files.`);
