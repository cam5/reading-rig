import type { PrismaClient } from "../../../generated/prisma/client";

export type GetSourceExcerptInput = {
  userId: string;
  sourceId: string;
  query?: string;
};

/**
 * Not yet buildable. The build plan's `Source` model — "user uploads used
 * as secondary material" — is M4 work (issue #23, "Secondary sources"),
 * and nothing in the current schema represents an uploaded source: there
 * is only the ingested Work/Chapter/Section/Paragraph tree for the
 * reader's own shelf.
 *
 * Three options were on the table: invent a Source table here (out of
 * scope for #25, and it'd have to be redone once #23 designs the real
 * one); quietly repoint this at Paragraph (which would make "source" a
 * lie — a Work you're reading is not a secondary source, and the design
 * explicitly treats them as different things); or keep the reading API's
 * six-tool shape honest and fail loudly with a message that says why.
 * This takes the third option — a typed stub, not a fake implementation,
 * so #23 has a real signature to fill in rather than a handler to unpick.
 */
export async function getSourceExcerpt(
  _db: PrismaClient,
  _input: GetSourceExcerptInput,
): Promise<never> {
  throw new Error(
    "get_source_excerpt has no Source model to query yet — the schema doesn't have one until " +
      "M4's #23 (Secondary sources) builds it.",
  );
}
