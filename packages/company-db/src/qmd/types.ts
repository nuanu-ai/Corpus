export interface QmdDocument<T = Record<string, unknown>> {
  frontmatter: T;
  body: string;
  raw: string;
}

export interface ParseOptions {
  strict?: boolean;
}
