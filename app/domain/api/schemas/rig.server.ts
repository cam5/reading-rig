import { z } from "zod";

// GET (SSE) is deliberately unschema'd here — see apiV1.smoke.test.ts's
// doc comment for why: a streaming response doesn't fit a single
// request/response shape, and there's no JSON body to validate.
export const rigMessageRequestSchema = z.object({
  message: z.string().trim().min(1, "A message is required."),
});

export const rigMessageResponseSchema = z.object({ ok: z.literal(true) });
