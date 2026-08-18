import { z } from "zod";
import { contentParagraphSchema } from "./paragraph.server";

export const readLoaderQuerySchema = z.object({
  section: z.string().nullable(),
});

const sectionOutlineSchema = z.object({
  id: z.string(),
  label: z.string(),
  ordinal: z.number().int(),
});

const chapterOutlineSchema = z.object({
  id: z.string(),
  workId: z.string(),
  label: z.string(),
  ordinal: z.number().int(),
  sections: z.array(sectionOutlineSchema),
});

const structuralParagraphSchema = z.object({
  id: z.string(),
  ordinal: z.number().int(),
  globalOrdinal: z.number().int(),
  wordCount: z.number().int(),
  section: z.object({
    id: z.string(),
    ordinal: z.number().int(),
    chapter: z.object({ id: z.string(), ordinal: z.number().int() }),
  }),
});

const sectionRefSchema = z.object({
  chapterId: z.string(),
  sectionId: z.string(),
});

export const readResponseSchema = z.object({
  work: z.object({
    id: z.string(),
    title: z.string(),
    author: z.string().nullable(),
    chapters: z.array(chapterOutlineSchema),
  }),
  structuralParagraphs: z.array(structuralParagraphSchema),
  content: z.object({
    paragraphs: z.array(contentParagraphSchema),
    minGlobalOrdinal: z.number().int(),
    maxGlobalOrdinal: z.number().int(),
  }),
  initialSection: sectionRefSchema.nullable(),
  bookmarkGlobalOrdinal: z.number().int(),
  progressPercent: z.number(),
  timeLeft: z.string(),
  anchorGlobalOrdinal: z.number().int(),
  isResume: z.boolean(),
});

// The four intents read.tsx's action (and this route's own) dispatch on —
// see handleReadAction.server.ts's actionHandlers. This only checks
// *shape*: field presence and type, so a malformed request gets a clean
// 400 instead of an unhandled JSON.parse throw or a bare `undefined`
// silently reaching a Prisma call. Business rules ("a note needs a body")
// stay in handleReadAction.server.ts, which both this route and read.tsx's
// page action already share — duplicating them here would just be a
// second place for the two to drift.
const spansJsonSchema = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "spans is not valid JSON" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.object({
          paragraphId: z.string(),
          start: z.number().int(),
          end: z.number().int(),
        }),
      )
      .min(1),
  );

export const readActionRequestSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("highlight"), spans: spansJsonSchema }),
  z.object({
    intent: z.literal("highlight-note"),
    spans: spansJsonSchema,
    body: z.string(),
    excerpt: z.string().optional(),
  }),
  z.object({
    intent: z.literal("note"),
    paragraphId: z.string(),
    highlightId: z.string().optional(),
    body: z.string(),
    excerpt: z.string().optional(),
  }),
  z.object({ intent: z.literal("bookmark"), paragraphId: z.string() }),
]);

export const readActionResponseSchema = z.object({ ok: z.literal(true) });
