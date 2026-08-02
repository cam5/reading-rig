// subset-font ships no types of its own (see its README's JS-only examples).
// Minimal ambient declaration for the one call subsetCaprasimo.ts makes.
declare module "subset-font" {
  type TargetFormat = "sfnt" | "truetype" | "woff" | "woff2";

  interface SubsetFontOptions {
    targetFormat?: TargetFormat;
    preserveNameIds?: number[];
    variationAxes?: Record<string, number | { min?: number; max?: number; default?: number }>;
    noLayoutClosure?: boolean;
  }

  export default function subsetFont(
    buffer: Buffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
