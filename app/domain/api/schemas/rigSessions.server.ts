import { z } from "zod";

// createdAt is already `.toISOString()`'d by the route before this schema
// ever sees it (unlike the content-paragraph schemas, which validate raw
// Prisma Date objects) — a plain string here, not z.date().
const sessionSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
});

export const rigSessionsResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  rigUnavailableReason: z.string().nullable(),
});

export const rigSessionCreateResponseSchema = sessionSummarySchema;
