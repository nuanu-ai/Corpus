import { parseQmd } from "@/lib/company-db/summary/qmd";

export interface ResolvedProfileTarget {
  filePath: string;
  existing: { frontmatter: Record<string, unknown>; body: string } | null;
}

export async function resolveMergedPeopleProfileTarget(input: {
  filePath: string;
  loadFile: (filePath: string) => Promise<string | null>;
}): Promise<ResolvedProfileTarget> {
  let currentPath = input.filePath;
  const visited = new Set<string>();

  while (!visited.has(currentPath)) {
    visited.add(currentPath);
    const raw = await input.loadFile(currentPath);

    if (!raw) {
      return {
        filePath: currentPath,
        existing: null,
      };
    }

    const parsed = parseQmd(raw);
    const mergedInto =
      typeof parsed.frontmatter.merged_into === "string" &&
      parsed.frontmatter.merged_into.trim().startsWith("people/")
        ? parsed.frontmatter.merged_into.trim()
        : null;

    if (parsed.frontmatter.crm_status === "merged" && mergedInto) {
      currentPath = mergedInto;
      continue;
    }

    return {
      filePath: currentPath,
      existing: parsed,
    };
  }

  return {
    filePath: input.filePath,
    existing: null,
  };
}
