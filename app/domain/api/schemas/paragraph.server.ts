import { z } from "zod";

/**
 * The shapes fetchContentWindow.server.ts's rows take on the wire —
 * shared by api.v1.read.tsx's initial `content` window and
 * api.v1.read-content.tsx's later ones, since both go through that one
 * function. Dates are validated as JS `Date` instances, not ISO strings:
 * these schemas check the route's in-memory return value *before*
 * react-router's own JSON serialization, not the bytes a client actually
 * receives — see errors.server.ts's doc comment for why that boundary is
 * where these run.
 */

export const highlightSpanSchema = z.object({
  id: z.string(),
  highlightId: z.string(),
  paragraphId: z.string(),
  startOffset: z.number().int(),
  endOffset: z.number().int(),
  highlight: z.object({
    id: z.string(),
    userId: z.string(),
    role: z.enum(["hand", "rig"]),
    createdAt: z.date(),
  }),
});

export const entrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  origin: z.enum(["hand", "rig"]),
  body: z.string(),
  anchorParagraphId: z.string(),
  highlightId: z.string().nullable(),
  // Free-form (see Entry.contextSnapshot's schema.prisma comment) — never
  // validated beyond "is JSON-shaped", the same way the domain layer
  // treats it.
  contextSnapshot: z.unknown(),
  rigSessionId: z.string().nullable(),
  wovenIntoEntryId: z.string().nullable(),
  createdAt: z.date(),
});

export const footnoteSchema = z.object({
  id: z.string(),
  paragraphId: z.string(),
  refId: z.string(),
  html: z.string(),
  text: z.string(),
  ordinal: z.number().int(),
});

export const contentParagraphSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  html: z.string(),
  text: z.string(),
  ordinal: z.number().int(),
  globalOrdinal: z.number().int(),
  wordCount: z.number().int(),
  kind: z.enum(["prose", "sceneBreak"]),
  isBlockquote: z.boolean(),
  highlightSpans: z.array(highlightSpanSchema),
  entries: z.array(entrySchema),
  footnotes: z.array(footnoteSchema),
});
