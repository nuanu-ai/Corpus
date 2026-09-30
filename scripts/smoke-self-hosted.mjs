import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import postgres from "postgres";

// Explicitly require a disposable, empty local database. Never use DATABASE_URL.
const databaseUrl = process.env.CORPUS_SMOKE_DATABASE_URL;
assert(databaseUrl, "Set CORPUS_SMOKE_DATABASE_URL to an empty local test database");
assert(["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname), "Smoke tests require a local database");
const sql = postgres(databaseUrl, { max: 1 });
const [{ count }] = await sql`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
assert.equal(count, 0, "Refusing to run against a nonempty database");
const directory = await mkdtemp(join(tmpdir(), "corpus-smoke-"));
const children = new Set();
async function freePortBlock(size = 1) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const servers = [];
    try {
      for (let i = 0; i < size; i++) {
        const server = createServer();
        servers.push(server);
        await new Promise((yes, no) => { server.once("error", no); server.listen(port + i, "127.0.0.1", yes); });
      }
      return port;
    } catch { /* try another free block */ }
    finally { await Promise.all(servers.map((server) => new Promise((done) => server.close(done)))); }
  }
  throw new Error("No free local port block");
}
const appPort = await freePortBlock();
const eventsPort = await freePortBlock(4);
const companyPort = await freePortBlock(40);
const base = `http://127.0.0.1:${appPort}`;
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  ...parseEnv(await readFile(".env.example", "utf8")),
  DATABASE_URL: databaseUrl, NEXT_PUBLIC_APP_URL: base, BETTER_AUTH_URL: base,
  TRUSTED_ORIGINS: base, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  COMPANY_DB_INTERNAL_SERVICE_SECRET: randomBytes(32).toString("hex"),
  COMPANY_DB_REPO: join(directory, "companies"), STORAGE_DIR: join(directory, "storage"),
  COMPANY_DB_PORT_START: String(companyPort),
  INNGEST_BASE_URL: `http://127.0.0.1:${eventsPort}`, NEXT_TELEMETRY_DISABLED: "1",
};
function start(args, name) {
  const child = spawn(process.execPath, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const log = createWriteStream(join(directory, `${name}.log`));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; log.write(chunk); });
  child.once("close", () => log.end());
  child.on("error", (error) => { output += String(error); });
  child.output = () => output;
  child.label = name;
  children.add(child);
  return child;
}
async function stop(child) {
  if (child) child.expectedExit = true;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([new Promise((done) => child.once("exit", done)), delay(12_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ }
  }
}
async function command(args, name) {
  const child = start(args, name);
  const code = await new Promise((done) => child.once("exit", done));
  assert.equal(code, 0, `${name}: ${child.output()}`);
}
async function eventually(check, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    for (const child of children) {
      if (child.label !== "schema" && !child.expectedExit && (child.exitCode !== null || child.signalCode !== null)) {
        throw new Error(`${child.label} exited: ${child.output().slice(-4000)}`);
      }
    }
    try { const value = await check(); if (value) return value; } catch (error) { if (error.fatal) throw error; lastError = error; }
    await delay(1_000);
  }
  throw new Error(`${label} timed out: ${lastError?.message || "condition not reached"}`);
}
function session() {
  const cookies = new Map();
  return async (path, { body, company, companyCookie, ...options } = {}) => {
    const headers = new Headers(options.headers);
    headers.set("origin", base);
    const cookieValues = [...cookies].filter(([key]) => key !== "active-company-id" || !companyCookie).map(([key, value]) => `${key}=${value}`);
    if (companyCookie) cookieValues.push(`active-company-id=${companyCookie}`);
    headers.set("cookie", cookieValues.join("; "));
    if (company) headers.set("x-company-id", company);
    if (body && !(body instanceof FormData)) { headers.set("content-type", "application/json"); body = JSON.stringify(body); }
    const response = await fetch(base + path, { ...options, body, headers, signal: AbortSignal.timeout(30_000) });
    for (const item of response.headers.getSetCookie()) {
      const [key, ...value] = item.split(";")[0].split("="); cookies.set(key, value.join("="));
    }
    const text = await response.text();
    return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
  };
}
const first = session();
const second = session();
function uploadForm() {
  const form = new FormData();
  form.append("file", new Blob(["Syntheticneedle is the project codename. This test document contains no real company data."], { type: "text/plain" }), "synthetic-knowledge.txt");
  return form;
}
let services;
try {
  await command(["node_modules/drizzle-kit/bin.cjs", "push"], "schema");
  start(["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], "app");
  services = start(["scripts/dev-services.mjs"], "services");
  await eventually(async () => (await first("/api/health")).status === 200, "application startup");
  assert.equal((await first("/api/companies")).status, 401);
  for (const [i, request] of [first, second].entries()) {
    const result = await request("/api/auth/sign-up/email", { method: "POST", body: {
      name: `Synthetic Auditor ${i}`, email: `auditor-${i}@example.com`, password: randomBytes(20).toString("hex"),
    } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const companyA = (await first("/api/companies")).data.activeCompanyId;
  const companyB = (await second("/api/companies")).data.activeCompanyId;
  assert(companyA && companyB && companyA !== companyB);
  assert.equal((await first("/api/company/query?domain=knowledge", { company: companyA })).status, 200);
  await eventually(async () => (await first("/api/health")).data.services.companyDb === "ok", "tenant startup");
  const accepted = await first("/api/documents/upload", { method: "POST", company: companyA, body: uploadForm() });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const id = accepted.data.documentId;
  await eventually(async () => {
    const response = await first(`/api/documents/status?documentId=${id}`, { company: companyA });
    assert.equal(response.status, 200);
    if (response.data.status === "failed") throw Object.assign(new Error(JSON.stringify(response.data)), { fatal: true });
    return response.data.status === "completed";
  }, "document completion", 180_000);
  const search = () => first("/api/company/search?q=Syntheticneedle", { company: companyA });
  const found = await search();
  assert.equal(found.status, 200);
  assert(JSON.stringify(found.data).includes(id), "Search must retain the source document ID");
  assert.equal((await second(`/api/documents/status?documentId=${id}`, { company: companyB })).status, 404);
  for (const request of [first, second]) {
    const inaccessible = request === first ? companyB : companyA;
    assert.equal((await request("/api/documents", { company: inaccessible })).status, 403);
    assert.equal((await request("/api/documents/upload", { method: "POST", company: inaccessible, body: uploadForm() })).status, 403);
  }
  assert.equal((await first("/api/documents", { company: "not-a-uuid" })).status, 403);
  const staleCookie = await first("/api/documents/upload", { method: "POST", companyCookie: companyB, body: uploadForm() });
  assert.equal(staleCookie.status, 403);
  assert(staleCookie.headers.getSetCookie().some((cookie) => cookie.startsWith("active-company-id=") && cookie.includes("Max-Age=0")));
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM documents`;
  assert.equal(total, 1, "Rejected uploads must not persist documents in either tenant");
  await stop(services);
  assert.equal((await first("/api/health")).status, 503);
  assert.equal((await first("/api/documents/upload", { method: "POST", company: companyA, body: uploadForm() })).status, 503);
  services = start(["scripts/dev-services.mjs"], "services-restarted");
  await eventually(async () => (await first("/api/health")).data.services.companyDb === "ok", "tenant restart");
  assert(JSON.stringify((await search()).data).includes(id), "Indexed knowledge must survive a service restart");
  console.log("PASS: signup → upload → processing → indexed search with provenance; tenant isolation; service outage and restart");
} finally {
  await Promise.all([...children].map(stop));
  for (const child of children) await writeFile(join(directory, `${child.label}.log`), child.output());
  await sql.end({ timeout: 5 });
  console.log(`Smoke-test logs: ${directory}`);
}
