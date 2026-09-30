export type ImportedCompanyMember = {
  personName: string;
  role: string | null;
  membershipDescription: string | null;
  personId: string | null;
  email: string | null;
  phoneOrWhatsApp: string | null;
  personAttributes: Record<string, string>;
};

export type ImportedCompanyRecord = {
  externalCompanyId: string | null;
  name: string;
  description: string | null;
  organizationId: string | null;
  parentExternalCompanyId: string | null;
  parentCompanyName: string | null;
  members: ImportedCompanyMember[];
};

function cleanCell(value: string): string {
  const trimmed = value.trim();
  const unwrapped =
    trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2
      ? trimmed.slice(1, -1)
      : trimmed;
  return unwrapped.trim();
}

function normalizeNullable(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = cleanCell(value);
  if (!cleaned || cleaned === "_") return null;
  return cleaned;
}

function parseMarkdownRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function parseAttributes(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();
      if (!normalizedKey || !normalizedValue) continue;
      next[normalizedKey] = normalizedValue;
    }
    return next;
  } catch {
    return {};
  }
}

function parseMembers(section: string): ImportedCompanyMember[] {
  if (section.includes("_No members found")) return [];
  const membersHeader =
    "| Person | Role | Membership description | Person ID | Email | Phone/WhatsApp | Person attributes |";
  const headerIndex = section.indexOf(membersHeader);
  if (headerIndex === -1) return [];

  const lines = section
    .slice(headerIndex)
    .split(/\r?\n/)
    .slice(2);

  const members: ImportedCompanyMember[] = [];
  for (const line of lines) {
    if (!line.startsWith("|")) break;
    if (line.includes("<details>")) break;
    const cells = parseMarkdownRow(line);
    if (cells.length < 7) continue;
    if (cells[0] === "---") continue;
    members.push({
      personName: cleanCell(cells[0]),
      role: normalizeNullable(cells[1]),
      membershipDescription: normalizeNullable(cells[2]),
      personId: normalizeNullable(cells[3]),
      email: normalizeNullable(cells[4]),
      phoneOrWhatsApp: normalizeNullable(cells[5]),
      personAttributes: parseAttributes(normalizeNullable(cells[6])),
    });
  }

  return members.filter((member) => member.personName.length > 0);
}

function parseFieldMap(section: string): Record<string, string> {
  const start = section.indexOf("| Field | Value |");
  const end = section.indexOf("### Members");
  if (start === -1) return {};
  const block = section.slice(start, end === -1 ? undefined : end);
  const lines = block.split(/\r?\n/).slice(2);
  const fields: Record<string, string> = {};
  for (const line of lines) {
    if (!line.startsWith("|")) break;
    const cells = parseMarkdownRow(line);
    if (cells.length < 2) continue;
    const key = cleanCell(cells[0]).toLowerCase();
    const value = cleanCell(cells.slice(1).join(" | "));
    if (!key) continue;
    fields[key] = value;
  }
  return fields;
}

function parseParent(value: string | undefined): {
  parentExternalCompanyId: string | null;
  parentCompanyName: string | null;
} {
  const normalized = normalizeNullable(value);
  if (!normalized) {
    return {
      parentExternalCompanyId: null,
      parentCompanyName: null,
    };
  }

  const match = normalized.match(/^`?([a-z0-9-]+)`?\s+\((.+)\)$/i);
  if (!match) {
    return {
      parentExternalCompanyId: normalized,
      parentCompanyName: null,
    };
  }

  return {
    parentExternalCompanyId: match[1] ?? null,
    parentCompanyName: match[2] ?? null,
  };
}

export function parseCompaniesMarkdown(markdown: string): ImportedCompanyRecord[] {
  const source = markdown.replace(/\r\n/g, "\n");
  const matches = [...source.matchAll(/^##\s+(.+)$/gm)];
  const results: ImportedCompanyRecord[] = [];

  for (const [index, match] of matches.entries()) {
    const title = match[1]?.trim();
    if (!title || title.toLowerCase() === "index") continue;

    const sectionStart = match.index ?? 0;
    const sectionEnd = matches[index + 1]?.index ?? source.length;
    const section = source.slice(sectionStart, sectionEnd);
    const fields = parseFieldMap(section);
    const parent = parseParent(fields.parent_company_id);

    results.push({
      externalCompanyId: normalizeNullable(fields.id),
      name: normalizeNullable(fields.name) ?? title,
      description: normalizeNullable(fields.description),
      organizationId: normalizeNullable(fields.organization_id),
      parentExternalCompanyId: parent.parentExternalCompanyId,
      parentCompanyName: parent.parentCompanyName,
      members: parseMembers(section),
    });
  }

  return results;
}
