import { Link } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { fetchCommonplaceEntry } from "~/domain/commonplace.server";
import { EntryCard } from "~/components/EntryCard";
import { fraunceLinks } from "~/domain/typography/fraunceLinks";
import type { Route } from "./+types/commonplace.$entryId";
import styles from "./commonplace.$entryId.module.css";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `${loaderData.entry.locator} — Reading Rig`
        : "Reading Rig",
    },
  ];
}

// EntryCard renders body text in .font-reading — see fraunceLinks.ts for
// why this isn't in root.tsx's global links.
export const links: Route.LinksFunction = () => fraunceLinks;

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return fetchCommonplaceEntry(db, user.id, params.entryId);
}

export default function CommonplaceEntry({ loaderData }: Route.ComponentProps) {
  const { entry } = loaderData;

  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex flex-none items-center gap-4 px-6 py-4">
        <span className={["font-heading", styles.title].join(" ")}>
          Reading Rig
        </span>
        <Link to="/commonplace" className={styles.backLink}>
          ← Commonplace
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        <div className={["mx-auto pt-6", styles.entryWrap].join(" ")}>
          <div className={["bg-bg p-8", styles.card].join(" ")}>
            <EntryCard
              origin={entry.origin}
              locator={entry.locator}
              excerpt={entry.excerpt}
              date={entry.date}
              body={entry.body}
            />

            <div className="mt-6">
              {/* .btn's own `color: var(--color-text)` outranks Organic's
                  unlayered `a { color }` on specificity alone (a class
                  beats an element selector regardless of layer or source
                  order), so this needs no override style the way a plain
                  `text-[...]` Link would — see the back link above, and
                  commonplace.tsx's centre column, for that version of the
                  same problem. */}
              <Link
                to={entry.openAtPassageHref}
                className={["btn btn-secondary", styles.openAtPassage].join(
                  " ",
                )}
              >
                Open at the passage
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
