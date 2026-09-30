const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const PLACEHOLDER_PREFIX = "\u0000TG";
const PLACEHOLDER_SUFFIX = "\u0000";

export type TelegramFormattedText = {
  text: string;
  parseMode: "HTML";
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPE_MAP[character] ?? character);
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isPotentialTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.split("|").length >= 3;
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInlineMarkdown(cell));
}

function padCell(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - value.length));
}

function renderMarkdownTable(lines: string[]): string {
  const header = parseTableRow(lines[0] ?? "");
  const rows = lines.slice(2).map(parseTableRow);
  const columnCount = Math.max(header.length, ...rows.map((row) => row.length), 0);
  const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
    return Math.max(
      header[columnIndex]?.length ?? 0,
      ...rows.map((row) => row[columnIndex]?.length ?? 0),
      3,
    );
  });

  const renderRow = (row: string[]) =>
    widths
      .map((width, columnIndex) => padCell(row[columnIndex] ?? "", width))
      .join("  ")
      .trimEnd();

  const tableText = [
    renderRow(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(renderRow),
  ].join("\n");

  return `<pre>${escapeHtml(tableText)}</pre>`;
}

function pushPlaceholder(placeholders: string[], html: string): string {
  const token = `${PLACEHOLDER_PREFIX}${placeholders.length}${PLACEHOLDER_SUFFIX}`;
  placeholders.push(html);
  return token;
}

function restorePlaceholders(value: string, placeholders: string[]): string {
  return value.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g"),
    (_, index: string) => placeholders[Number(index)] ?? "",
  );
}

function renderInlineMarkdown(raw: string): string {
  const placeholders: string[] = [];
  let value = raw;

  value = value.replace(/`([^`\n]+)`/g, (_, code: string) =>
    pushPlaceholder(placeholders, `<code>${escapeHtml(code)}</code>`),
  );

  value = value.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label: string, href: string) =>
      pushPlaceholder(
        placeholders,
        `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`,
      ),
  );

  value = escapeHtml(value);
  value = value.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  value = value.replace(/__([^_\n]+)__/g, "<b>$1</b>");
  return restorePlaceholders(value, placeholders);
}

function renderMarkdownLine(raw: string): string {
  const heading = raw.match(/^\s{0,3}#{1,6}\s+(.+)$/);
  if (heading) {
    return `<b>${renderInlineMarkdown(heading[1]!.trim())}</b>`;
  }

  return renderInlineMarkdown(raw);
}

export function formatTelegramMessageText(input: string): TelegramFormattedText {
  const normalized = input.trim();
  if (!normalized) {
    return { text: "", parseMode: "HTML" };
  }

  const lines = normalized.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      output.push(`<pre>${escapeHtml(codeLines.join("\n"))}</pre>`);
      continue;
    }

    if (
      isPotentialTableRow(line) &&
      index + 1 < lines.length &&
      isTableSeparatorLine(lines[index + 1] ?? "")
    ) {
      const tableLines = [line, lines[index + 1] ?? ""];
      index += 2;
      while (index < lines.length && isPotentialTableRow(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      index -= 1;
      output.push(renderMarkdownTable(tableLines));
      continue;
    }

    output.push(renderMarkdownLine(line));
  }

  return {
    text: output.join("\n"),
    parseMode: "HTML",
  };
}
