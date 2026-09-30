import YAML from "yaml";

export interface ParsedQmd {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseQmd(raw: string): ParsedQmd {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    return { frontmatter: {}, body: raw.trim() };
  }

  const frontmatter = (YAML.parse(match[1]) as Record<string, unknown> | null) ?? {};
  return {
    frontmatter,
    body: (match[2] ?? "").trim(),
  };
}

export function toQmd(frontmatter: Record<string, unknown>, body = ""): string {
  const yaml = YAML.stringify(frontmatter).trimEnd();
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return `---\n${yaml}\n---\n`;
  }
  return `---\n${yaml}\n---\n\n${normalizedBody}\n`;
}
