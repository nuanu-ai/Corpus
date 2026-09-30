import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

nextEnv.loadEnvConfig(process.cwd(), true);
if (process.env.NODE_ENV === "production" || process.env.INNGEST_DEV !== "1") {
  throw new Error("This command is for local development. Set INNGEST_DEV=1 in .env.local.");
}
const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
const events = new URL(process.env.INNGEST_BASE_URL || "http://127.0.0.1:8288");
for (const url of [app, events]) {
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Local development services require localhost URLs.");
  }
}
const children = [
  spawn(process.execPath, ["--import", "tsx", "scripts/company-db-supervisor.ts"], {
    stdio: "inherit", detached: true,
  }),
  spawn(resolve("node_modules/.bin/inngest"), [
    "dev", "--host", "127.0.0.1", "--port", events.port || "8288",
    "--connect-gateway-port", String(Number(events.port || 8288) + 1),
    "--connect-gateway-grpc-port", String(Number(events.port || 8288) + 2),
    "--connect-executor-grpc-port", String(Number(events.port || 8288) + 3),
    "--no-discovery", "-u", new URL("/api/inngest", app).href,
  ], { stdio: "inherit", detached: true }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    }
  }
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
for (const child of children) {
  child.once("error", (error) => { console.error(error); stop(1); });
  child.once("exit", (code) => { if (!stopping) stop(code || 1); });
}
