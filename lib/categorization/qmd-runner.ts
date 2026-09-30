import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Internal helper that wraps the QMD CLI call.
 * Separated into its own module so it can be mocked in tests.
 */
export async function runQmd(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("qmd", args);
  return stdout;
}
