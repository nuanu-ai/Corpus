import { execFile } from "child_process";
import { access, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { extname, join } from "path";
import { promisify } from "util";
import { buildPythonBridgeExecOptions } from "./subprocess-timeout";

const execFileAsync = promisify(execFile);

const BRIDGE_SCRIPT_PATH = join(
  process.cwd(),
  "extraction",
  "src",
  "extraction",
  "unstructured_bridge.py",
);

interface BridgeSuccess {
  ok: true;
  backend: "unstructured" | "pdfplumber";
  text: string;
  metadata?: Record<string, unknown>;
}

interface BridgeFailure {
  ok: false;
  error: string;
}

type BridgeResult = BridgeSuccess | BridgeFailure;

export interface UnstructuredTextResult {
  backend: "unstructured" | "pdfplumber";
  text: string;
  metadata?: Record<string, unknown>;
}

function resolveTempExtension(fileType: "pdf" | "image", fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (ext) return ext;
  return fileType === "pdf" ? ".pdf" : ".png";
}

async function ensureBridgeScriptExists(): Promise<void> {
  try {
    await access(BRIDGE_SCRIPT_PATH);
  } catch {
    throw new Error(`Unstructured bridge script not found at ${BRIDGE_SCRIPT_PATH}`);
  }
}

export async function extractUnstructuredText(
  buffer: Buffer,
  input: {
    fileType: "pdf" | "image";
    fileName: string;
  },
): Promise<UnstructuredTextResult> {
  await ensureBridgeScriptExists();

  const tempDir = await mkdtemp(join(tmpdir(), "corpus-unstructured-"));
  const tempPath = join(
    tempDir,
    `input${resolveTempExtension(input.fileType, input.fileName)}`,
  );

  try {
    await writeFile(tempPath, buffer);

    const { stdout } = await execFileAsync(
      "python3",
      [BRIDGE_SCRIPT_PATH, "--input", tempPath, "--file-type", input.fileType],
      buildPythonBridgeExecOptions("UNSTRUCTURED_TEXT_BRIDGE_TIMEOUT_MS", 60_000),
    );

    const stdoutText = String(stdout ?? "");
    if (!stdoutText.trim()) {
      throw new Error("Unstructured bridge returned empty output");
    }

    const result = JSON.parse(stdoutText) as BridgeResult;
    if (!result.ok) {
      throw new Error(result.error);
    }

    return {
      backend: result.backend,
      text: result.text,
      metadata: result.metadata,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
