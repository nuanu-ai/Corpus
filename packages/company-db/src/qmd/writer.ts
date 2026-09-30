import YAML from "yaml";

export function writeQmd(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const yamlStr = YAML.stringify(frontmatter).trimEnd();
  if (body) {
    return `---\n${yamlStr}\n---\n${body}`;
  }
  return `---\n${yamlStr}\n---\n`;
}
