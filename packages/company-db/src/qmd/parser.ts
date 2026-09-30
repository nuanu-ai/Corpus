import YAML from "yaml";
import type { QmdDocument, ParseOptions } from "./types.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

export function parseQmd<T = Record<string, unknown>>(
  raw: string,
  options?: ParseOptions
): QmdDocument<T> {
  const match = raw.match(FRONTMATTER_REGEX);

  if (!match) {
    if (options?.strict) {
      throw new Error("QMD document is missing YAML frontmatter delimiters");
    }
    return {
      frontmatter: {} as T,
      body: raw,
      raw,
    };
  }

  const yamlStr = match[1];
  const body = match[2]?.trimEnd() ?? "";

  const frontmatter = YAML.parse(yamlStr) as T;

  return {
    frontmatter: frontmatter ?? ({} as T),
    body,
    raw,
  };
}
