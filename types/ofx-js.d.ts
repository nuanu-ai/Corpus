declare module "ofx-js" {
  export function parse(data: string): Promise<Record<string, unknown>>;
}
