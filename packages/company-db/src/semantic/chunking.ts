import { createHash } from "crypto";

import type { SemanticChunk } from "./types.js";

const TOKEN_RATIO = 1.3;
const DEFAULT_MAX_TOKENS = 420;
const DEFAULT_OVERLAP_TOKENS = 84;

interface ChunkingOptions {
  title?: string | null;
  body: string;
  maxTokens?: number;
  overlapTokens?: number;
}

interface SectionBlock {
  sectionPath: string[];
  text: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function estimateTokenCount(text: string): number {
  const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * TOKEN_RATIO));
}

function tokenLimitToWordLimit(tokens: number): number {
  return Math.max(1, Math.floor(tokens / TOKEN_RATIO));
}

function safeSnippet(value: string, maxLength = 220): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function splitIntoSections(body: string): SectionBlock[] {
  const lines = body.split(/\r?\n/);
  const sections: SectionBlock[] = [];
  let currentHeadings: string[] = [];
  let activeHeadings: string[] = [];
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (!text) {
      currentLines = [];
      return;
    }

    sections.push({
      sectionPath: [...activeHeadings],
      text,
    });
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      const heading = normalizeWhitespace(headingMatch[2]);
      currentHeadings = currentHeadings.slice(0, level - 1);
      currentHeadings[level - 1] = heading;
      activeHeadings = [...currentHeadings];
      continue;
    }

    currentLines.push(line);
  }

  flush();

  if (sections.length > 0) return sections;

  const raw = body.trim();
  if (!raw) return [];

  return [{ sectionPath: [], text: raw }];
}

interface TextUnit {
  text: string;
  wordCount: number;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean);
}

function createTextUnits(text: string, maxWords: number, overlapWords: number): TextUnit[] {
  const paragraphs = splitParagraphs(text);
  const sourceParagraphs = paragraphs.length > 0 ? paragraphs : [normalizeWhitespace(text)];
  const units: TextUnit[] = [];
  const longStepWords = Math.max(1, maxWords - overlapWords);

  for (const paragraph of sourceParagraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      continue;
    }

    if (words.length <= maxWords) {
      units.push({ text: paragraph, wordCount: words.length });
      continue;
    }

    for (let start = 0; start < words.length; start += longStepWords) {
      const window = words.slice(start, start + maxWords);
      if (window.length === 0) {
        break;
      }

      units.push({
        text: window.join(" ").trim(),
        wordCount: window.length,
      });

      if (start + maxWords >= words.length) {
        break;
      }
    }
  }

  return units;
}

function takeOverlapUnits(units: TextUnit[], overlapWords: number): TextUnit[] {
  if (overlapWords <= 0 || units.length === 0) {
    return [];
  }

  const selected: TextUnit[] = [];
  let totalWords = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    selected.unshift(units[index]);
    totalWords += units[index].wordCount;
    if (totalWords >= overlapWords) {
      break;
    }
  }

  return selected;
}

function buildEmbeddingText(title: string | null | undefined, sectionPath: string[], bodyText: string): string {
  const parts = [title?.trim() || "", sectionPath.join(" > "), normalizeWhitespace(bodyText)].filter(Boolean);
  return parts.join("\n\n");
}

function stableChunkId(sectionPath: string[], text: string, chunkIndex: number): string {
  const hash = createHash("sha1")
    .update(sectionPath.join(" > "))
    .update("\n")
    .update(normalizeWhitespace(text))
    .digest("hex")
    .slice(0, 12);
  return `chunk-${chunkIndex + 1}-${hash}`;
}

export function createSemanticChunks(options: ChunkingOptions): SemanticChunk[] {
  const sections = splitIntoSections(options.body);
  if (sections.length === 0) return [];

  const maxWords = tokenLimitToWordLimit(options.maxTokens ?? DEFAULT_MAX_TOKENS);
  const overlapWords = tokenLimitToWordLimit(options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS);

  const chunks: SemanticChunk[] = [];

  for (const section of sections) {
    const units = createTextUnits(section.text, maxWords, overlapWords);
    if (units.length === 0) continue;

    let buffer: TextUnit[] = [];
    let bufferWords = 0;

    const flushChunk = () => {
      if (buffer.length === 0) return;
      const bodyText = buffer.map((unit) => unit.text).join("\n\n").trim();
      const chunkIndex = chunks.length;
      const text = buildEmbeddingText(options.title, section.sectionPath, bodyText);
      chunks.push({
        chunkId: stableChunkId(section.sectionPath, bodyText, chunkIndex),
        chunkIndex,
        sectionPath: [...section.sectionPath],
        text,
        bodyText,
        snippet: safeSnippet(bodyText),
        tokenCount: estimateTokenCount(text),
      });
    };

    for (const unit of units) {
      if (buffer.length > 0 && bufferWords + unit.wordCount > maxWords) {
        flushChunk();
        buffer = takeOverlapUnits(buffer, overlapWords);
        bufferWords = buffer.reduce((total, current) => total + current.wordCount, 0);

        if (bufferWords + unit.wordCount > maxWords) {
          buffer = [];
          bufferWords = 0;
        }
      }

      buffer.push(unit);
      bufferWords += unit.wordCount;
    }

    flushChunk();
  }

  return chunks;
}
