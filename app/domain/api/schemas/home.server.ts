import { z } from "zod";

export const homeResponseSchema = z.object({
  userId: z.string(),
  works: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      author: z.string().nullable(),
      coverMediaType: z.string().nullable(),
    }),
  ),
});
