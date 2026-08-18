import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { fetchCommonplaceEntry } from "~/domain/commonplace.server";
import { commonplaceEntryResponseSchema } from "~/domain/api/schemas/commonplace.server";
import type { Route } from "./+types/api.v1.commonplace.$entryId";

/**
 * JSON counterpart to commonplace.$entryId.tsx's page loader — same
 * fetchCommonplaceEntry call, same shape (including its 404 for an entry
 * that doesn't exist or isn't this user's).
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const data = await fetchCommonplaceEntry(db, user.id, params.entryId);
  return commonplaceEntryResponseSchema.parse(data);
}
