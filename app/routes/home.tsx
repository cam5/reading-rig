import { Link } from "react-router";
import { DisplayText } from "~/components/DisplayText";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Reading Rig" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const works = await db.work.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, author: true },
  });
  return { userId: user.id, works };
}

// A real shelf, minimally: enough to reach /read/:workId from a browser.
// Ingesting (npm run ingest) and the full library UI are #5 and M4's,
// respectively — this is just the bare list a click-through needs.
export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-prose px-6 py-24">
      <h1 className="text-2xl">
        <DisplayText text="Reading Rig" />
      </h1>
      {loaderData.works.length === 0 ? (
        <p className="mt-3 text-sm opacity-60">
          Nothing on the shelf yet — run <code>npm run ingest &lt;path.epub&gt;</code>.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {loaderData.works.map((work) => (
            <li key={work.id}>
              <Link to={`/read/${work.id}`} className="text-[15px] hover:underline">
                {work.title}
              </Link>
              {work.author && <span className="ml-2 text-sm opacity-50">{work.author}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-8 text-xs opacity-40">signed in as {loaderData.userId}</p>
    </main>
  );
}
