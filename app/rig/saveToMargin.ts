import type { Posture, Prisma, PrismaClient } from "../../generated/prisma/client";

export type SaveToMarginInput = {
  userId: string;
  body: string;
  posture: Posture;
  anchorParagraphId: string;
  contextSnapshot: Prisma.InputJsonValue;
};

/**
 * The real Entry-creation half of #29's "save to margin" — a Rig answer
 * becomes an `Entry` with `origin: "rig"`, carrying the posture it was
 * asked under, the paragraph it was anchored to, and the context set that
 * was actually in view. Pulled out of app/routes/rig.tsx's action so it
 * can be tested against a real database (createTestDb, same as #25's tool
 * handlers) rather than only through the route layer, which
 * vitest.config.ts's `include` deliberately doesn't cover yet — "component
 * and route tests, when they arrive, get their own project entry."
 *
 * Caller's job, not this function's: validating `posture` is a real
 * PostureId, resolving/owning `anchorParagraphId` against the requesting
 * user's own work, and parsing `contextSnapshot` out of whatever wire
 * format it arrived in (a JSON string, over a form POST). This function
 * trusts all four fields and just writes the row — the same division of
 * labour dispatchTool.ts keeps with its own handlers.
 *
 * Deliberately produces the exact same shape `db.entry.create` already
 * makes for a hand entry (read.tsx's `"note"` intent) — same table, same
 * fields, only `origin`/`posture` differing — which is the whole
 * mechanism behind this ticket's done-criterion: EntryCard and
 * /commonplace never need to know which path created a row.
 */
export async function saveToMargin(db: PrismaClient, input: SaveToMarginInput) {
  return db.entry.create({
    data: {
      userId: input.userId,
      origin: "rig",
      posture: input.posture,
      body: input.body,
      anchorParagraphId: input.anchorParagraphId,
      contextSnapshot: input.contextSnapshot,
    },
  });
}
