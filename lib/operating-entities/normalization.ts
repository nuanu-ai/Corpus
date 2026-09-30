import type { OperatingEntityObjectType, OperatingEntityStatus } from "./types";

const CYRILLIC_CONFUSABLES: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O",
  Р: "P", С: "C", Т: "T", У: "Y", Х: "X", а: "a", е: "e",
  о: "o", р: "p", с: "c", у: "y", х: "x",
};

export function replaceCyrillicConfusables(value: string): string {
  return Array.from(value).map((char) => CYRILLIC_CONFUSABLES[char] ?? char).join("");
}

export function normalizeOperatingSearchKey(value: string): string {
  return replaceCyrillicConfusables(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyOperatingEntity(value: string): string {
  return normalizeOperatingSearchKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function stripSpreadsheetStatus(value: string): {
  name: string;
  sourceStatus: "available" | "active" | null;
} {
  let sourceStatus: "available" | "active" | null = null;
  let name = value.trim().replace(/^-+\s*/, "");
  name = name.replace(/\((available|active)\)/gi, (_match, status: string) => {
    sourceStatus = status.toLowerCase() as "available" | "active";
    return "";
  });
  return { name: name.replace(/\s+/g, " ").trim(), sourceStatus };
}

export function normalizeDisplayName(value: string): string {
  return stripSpreadsheetStatus(value).name
    .normalize("NFKC")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferObjectTypeFromName(name: string): OperatingEntityObjectType {
  const key = normalizeOperatingSearchKey(name);
  if (!key) return "unknown";
  if (/^(pt|ltd|llc|inc|corp)\b/.test(key) || /\b(ltd|llc|inc|corp)$/.test(key)) return "legal_entity";
  if (key === "example-holdings" || key.endsWith(" group")) return "operating_domain";
  if (key.includes("department") || key === "finance") return "department";
  if (key.includes("partner")) return "partner";
  return "project";
}

export function inferStatusFromRaw(input: {
  project: string;
  legalEntity?: string;
  notes?: string[];
}): OperatingEntityStatus {
  const blob = normalizeOperatingSearchKey([input.project, input.legalEntity ?? "", ...(input.notes ?? [])].join(" "));
  if (blob.includes("outside perimeter")) return "outside_perimeter";
  if (blob.includes("deprecated") || blob.includes("duplicate")) return "deprecated";
  return "draft";
}

export function splitSpreadsheetList(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(/[/,;]+|\s+\+\s+/g).map(normalizeDisplayName).filter(Boolean);
}
