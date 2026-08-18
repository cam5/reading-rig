import { z } from "zod";

export const mentionSuggestionsQuerySchema = z.object({
  work: z.string().min(1),
  // Not .min(1): a bare "@" (empty query) is a real, meaningful request —
  // "what's closest to my bookmark" — not a malformed one. See
  // searchMentionCandidates.server.ts's own doc comment.
  q: z.string(),
});

const passageSchema = z.object({
  paragraphId: z.string(),
  workId: z.string(),
  workTitle: z.string(),
  chapterOrdinal: z.number().int(),
  sectionOrdinal: z.number().int(),
  ordinal: z.number().int(),
  globalOrdinal: z.number().int(),
  text: z.string(),
  html: z.string(),
  locator: z.string(),
});

const noteMatchSchema = z.object({
  entryId: z.string(),
  workId: z.string(),
  workTitle: z.string(),
  body: z.string(),
  anchorParagraphId: z.string(),
  locator: z.string(),
  globalOrdinal: z.number().int(),
});

export const mentionSuggestionsResponseSchema = z.object({
  suggestions: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("paragraph"), passage: passageSchema }),
      z.object({ kind: z.literal("note"), note: noteMatchSchema }),
    ]),
  ),
});
