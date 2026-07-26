import { requireUser } from "~/user.server";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Reading Rig" }];
}

export async function loader() {
  const user = await requireUser();
  return { userId: user.id };
}

// Deliberately bare. The shelf belongs here eventually; the reader itself is
// #7, and until #5 can ingest a book there is nothing true to put on a shelf.
export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-prose px-6 py-24">
      <h1 className="text-2xl">Reading Rig</h1>
      <p className="mt-3 text-sm opacity-60">Nothing on the shelf yet.</p>
      <p className="mt-1 text-xs opacity-40">signed in as {loaderData.userId}</p>
    </main>
  );
}
