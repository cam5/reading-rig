import { z } from "zod";

// GET (SSE) is deliberately unschema'd here — see apiV1.smoke.test.ts's
// doc comment for why: a streaming response doesn't fit a single
// request/response shape, and there's no JSON body to validate.
export const rigMessageRequestSchema = z.object({
  message: z.string().trim().min(1, "A message is required."),
  // The earliest locator-bearing pill in this message, or (no pills) the
  // earliest on-screen paragraph at send time — see TokenComposer's
  // firstPillAnchorOrdinal and RigLivePanel's handleSend. Omitted from the
  // form body entirely (not sent as an empty string — that would coerce to
  // 0, a real ordinal) when there's nothing to peg to yet. Only ever acted
  // on for a session that isn't anchored already — see api.v1.rig.tsx's
  // action.
  anchorGlobalOrdinal: z.coerce.number().int().optional(),
});

export const rigMessageResponseSchema = z.object({ ok: z.literal(true) });
