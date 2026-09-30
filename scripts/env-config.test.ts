import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("database tooling reads DATABASE_URL from .env.local without a shell export", () => {
  const directory = mkdtempSync(join(tmpdir(), "corpus-env-test-"));
  const config = resolve("drizzle.config.ts");
  try {
    writeFileSync(join(directory, ".env.local"), "DATABASE_URL=postgresql://example@localhost/example\n");
    const output = execFileSync(process.execPath, [
      "--import", resolve("node_modules/tsx/dist/loader.mjs"), "-e",
      `const config = require(${JSON.stringify(config)}).default; console.log(config.dbCredentials.url);`,
    ], { cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "development" } });
    expect(output.trim()).toBe("postgresql://example@localhost/example");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
