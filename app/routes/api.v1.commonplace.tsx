import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { fetchCommonplaceShelf } from "~/domain/commonplace.server";
import { parseOrBadRequest } from "~/domain/api/errors.server";
import {
  commonplaceLoaderQuerySchema,
  commonplaceResponseSchema,
} from "~/domain/api/schemas/commonplace.server";
import type { Route } from "./+types/api.v1.commonplace";

/**
 * JSON counterpart to commonplace.tsx's page loader — same
 * fetchCommonplaceShelf call, same `?entry=` selection, same shape. See
 * api.v1.home.tsx's doc comment for why this is a separate route rather
 * than commonplace.tsx itself.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const { entry } = parseOrBadRequest(commonplaceLoaderQuerySchema, {
    entry: new URL(request.url).searchParams.get("entry"),
  });
  const data = await fetchCommonplaceShelf(db, user.id, entry);
  return commonplaceResponseSchema.parse(data);
}
