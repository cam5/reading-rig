import { redirect } from "react-router";
import { destroyUserSession } from "~/auth/session.server";
import type { Route } from "./+types/auth.logout";

// Action-only, no loader/component: signing out is a state change (POST),
// never a page a GET can land on or a search-engine/prefetcher can trigger.
export async function action({ request }: Route.ActionArgs) {
  return destroyUserSession(request);
}

export async function loader() {
  throw redirect("/");
}
