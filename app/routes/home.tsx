import { Link } from "react-router";
import { DisplayText } from "~/components/DisplayText";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { workAccessWhere } from "~/domain/work/workAccessWhere.server";
import type { Route } from "./+types/home";
import styles from "./home.module.css";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Reading Rig" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const works = await db.work.findMany({
    where: workAccessWhere(user.id),
    orderBy: { createdAt: "asc" },
    // coverMediaType only, not coverImage itself — enough to know whether
    // to render a thumbnail without pulling every cover's bytes into one
    // list query. The actual bytes are fetched per-work by the browser,
    // as a normal cached <img> request against /cover/*.
    select: { id: true, title: true, author: true, coverMediaType: true },
  });
  return { userId: user.id, works };
}

// A real shelf, minimally: enough to reach /read/:workId from a browser.
// Ingesting (npm run ingest) and the full library UI are #5 and M4's,
// respectively — this is just the bare list a click-through needs.
export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-prose px-6 py-24">
      <h1 className={styles.heading}>
        <DisplayText text="Reading Rig" />
      </h1>
      {loaderData.works.length === 0 ? (
        <p className={["mt-3", styles.empty].join(" ")}>
          Nothing on the shelf yet — run{" "}
          <code>npm run ingest &lt;path.epub&gt;</code>.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {loaderData.works.map((work) => (
            <li key={work.id} className="flex items-center gap-3">
              {work.coverMediaType ? (
                <img
                  src={`/cover/${work.id}`}
                  alt=""
                  className="h-12 w-8 flex-shrink-0 rounded-sm object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-12 w-8 flex-shrink-0 rounded-sm border border-black/15"
                />
              )}
              <span>
                <Link to={`/read/${work.id}`} className={styles.workLink}>
                  {work.title}
                </Link>
                {work.author && (
                  <span className={["ml-2", styles.author].join(" ")}>
                    {work.author}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={["mt-8", styles.footer].join(" ")}>
        signed in as {loaderData.userId}
      </p>
    </main>
  );
}
