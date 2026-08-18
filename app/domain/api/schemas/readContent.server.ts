import { z } from "zod";
import { contentParagraphSchema } from "./paragraph.server";

// z.coerce.number() replaces the loader's own hand-rolled Number(...) +
// Number.isFinite(...) checks — a non-numeric or missing `min`/`max` now
// fails validation with a structured 400 instead of silently becoming
// NaN and reaching fetchContentWindow's Prisma query.
export const readContentQuerySchema = z.object({
  work: z.string().min(1),
  min: z.coerce.number().finite(),
  max: z.coerce.number().finite(),
});

export const readContentResponseSchema = z.object({
  paragraphs: z.array(contentParagraphSchema),
});
