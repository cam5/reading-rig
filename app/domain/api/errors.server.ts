import type { z } from "zod";

/**
 * The one JSON error envelope every /api/v1 route uses — `{ error, issues?
 * }`, a 400 — for a request that fails its zod schema. Contrast with the
 * bare-text `Response("...", { status })` the browser-facing page routes
 * throw (assertWorkReadableBy.server.ts and friends): those predate this
 * layer and stay that way, since a page navigation never parses the body,
 * but a JSON client should get something structured to work with.
 */
export function badRequest(issues: z.ZodIssue[]): Response {
  return Response.json(
    {
      error: "Bad request",
      issues: issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

/**
 * Parses `input` against `schema`, throwing the standard 400 envelope
 * (via `badRequest`) on failure instead of returning a result union — every
 * call site here is inside a loader/action, where a thrown Response is
 * already the idiomatic "stop and answer with this" (see
 * assertWorkReadableBy.server.ts's own 404, same pattern).
 */
export function parseOrBadRequest<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw badRequest(result.error.issues);
  return result.data;
}
