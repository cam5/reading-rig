import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Reading Rig" }];
}

// Deliberately bare. The shelf belongs here eventually; the reader itself is
// #7, and until #5 can ingest a book there is nothing true to put on a shelf.
export default function Home() {
  return (
    <main className="mx-auto max-w-prose px-6 py-24">
      <h1 className="text-2xl">Reading Rig</h1>
      <p className="mt-3 text-sm opacity-60">Nothing on the shelf yet.</p>
    </main>
  );
}
