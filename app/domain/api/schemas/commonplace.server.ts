import { z } from "zod";

export const commonplaceLoaderQuerySchema = z.object({
  entry: z.string().nullable(),
});

const marginContextSchema = z.object({
  before: z.string(),
  match: z.string(),
  after: z.string(),
});

const shelfEntrySchema = z.object({
  id: z.string(),
  origin: z.enum(["hand", "rig"]),
  body: z.string(),
  excerpt: z.string().optional(),
  date: z.string(),
  locator: z.string(),
});

export const commonplaceResponseSchema = z.object({
  totalEntries: z.number().int(),
  totalWorks: z.number().int(),
  readingHref: z.string().nullable(),
  when: z.array(
    z.object({
      label: z.string(),
      count: z.number().int(),
      current: z.boolean(),
    }),
  ),
  provenance: z.object({ hand: z.number().int(), rig: z.number().int() }),
  selectedEntryId: z.string().nullable(),
  margin: z
    .object({
      workId: z.string(),
      sectionId: z.string(),
      context: marginContextSchema,
      nearbyCount: z.number().int(),
    })
    .nullable(),
  entries: z.array(shelfEntrySchema),
});

export const commonplaceEntryResponseSchema = z.object({
  entry: z.object({
    id: z.string(),
    origin: z.enum(["hand", "rig"]),
    body: z.string(),
    excerpt: z.string().optional(),
    date: z.string(),
    locator: z.string(),
    openAtPassageHref: z.string(),
  }),
});
