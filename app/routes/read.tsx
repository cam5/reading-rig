import { Link } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { ReadingParagraph } from "~/components/ReadingParagraph";
import { SelectionHighlighter } from "~/components/SelectionHighlighter";
import { formatLocator } from "~/domain/locator";
import { highlightClassName } from "~/domain/paragraph/highlightRole";
import type { Route } from "./+types/read";

// The six postures from the design's lens rail (1c) and chip row (2a/2c).
// Purely decorative here — no selection state, no tool calls. Real posture
// invocation is M3's.
const POSTURES = ["Interrogate", "Steelman", "Connect", "Close-read", "Context", "Recap"];

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.work.title} — Reading Rig` : "Reading Rig" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const user = await requireUser();
  const workId = params["*"];

  // Chapter/section metadata only here — cheap, no paragraph text — so
  // rendering one section doesn't pull the whole book's text off disk.
  const work = await db.work.findFirstOrThrow({
    where: { id: workId, userId: user.id },
    include: {
      chapters: {
        orderBy: { ordinal: "asc" },
        include: { sections: { orderBy: { ordinal: "asc" }, select: { id: true, label: true, ordinal: true } } },
      },
    },
  });

  // No ReadingPosition yet (#10 builds the bookmark) — the reader always
  // opens at the first chapter's first section for now.
  const chapter = work.chapters[0] as (typeof work.chapters)[number] | undefined;
  const section = chapter?.sections[0];

  const paragraphs = section
    ? await db.paragraph.findMany({
        where: { sectionId: section.id },
        orderBy: { ordinal: "asc" },
        include: { highlights: true },
      })
    : [];

  return { work, chapter, section, paragraphs };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser();
  const formData = await request.formData();
  const paragraphId = String(formData.get("paragraphId"));
  const startOffset = Number(formData.get("startOffset"));
  const endOffset = Number(formData.get("endOffset"));

  // Same ownership boundary the loader enforces: a paragraph only exists
  // for this action if it resolves back to the requesting user's own work.
  const paragraph = await db.paragraph.findFirst({
    where: { id: paragraphId, section: { chapter: { work: { userId: user.id } } } },
  });
  if (!paragraph) throw new Response("Not found", { status: 404 });

  // Every highlight made through this UI is role: hand — there's no Rig
  // yet to make the other kind (that's M3's).
  await db.highlight.create({
    data: { paragraphId, startOffset, endOffset, role: "hand" },
  });

  return { ok: true };
}

export default function Read({ loaderData }: Route.ComponentProps) {
  const { work, chapter, section, paragraphs } = loaderData;

  // A real number, not a placeholder string — but a coarse one. #10 builds
  // the true bookmark-driven "37% · 4h left" readout from globalOrdinal;
  // until then this is just "how far into the chapter list are we".
  const roughProgress = chapter ? Math.round((chapter.ordinal / work.chapters.length) * 100) : 0;

  const highlights = section
    ? paragraphs.flatMap((paragraph) =>
        paragraph.highlights.map((highlight) => ({
          id: highlight.id,
          locator: formatLocator({
            sectionLabel: String(section.ordinal),
            paragraphOrdinal: paragraph.ordinal,
          }),
          text: paragraph.text.slice(highlight.startOffset, highlight.endOffset),
        })),
      )
    : [];

  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex flex-none items-center gap-4 px-6 py-4">
        <span className="font-heading text-lg">Reading Rig</span>
        <span className="text-[13px] opacity-60">{work.title}</span>
        <span className="ml-auto text-[11px] uppercase tracking-wide opacity-45">{roughProgress}%</span>
        <div className="seg">
          <Link
            to={`/read/${work.id}`}
            className="seg-opt"
            style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
          >
            Reading
          </Link>
          <Link to="/commonplace" className="seg-opt border-l border-divider">
            Commonplace
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SelectionHighlighter>
          <div className="min-w-0 flex-1 overflow-y-auto rounded-tr-[28px] bg-bg px-16 pt-12">
            <div className="mx-auto max-w-[660px]">
              {chapter && section && (
                <div className="mb-6 flex items-baseline gap-3">
                  <span className="text-[10.5px] uppercase tracking-wide text-[var(--color-accent)]">
                    Ch. {chapter.ordinal} · §{section.ordinal}
                  </span>
                  <span className="h-px flex-1 bg-divider" />
                </div>
              )}
              {paragraphs.map((paragraph) => (
                <ReadingParagraph
                  key={paragraph.id}
                  paragraph={paragraph}
                  highlights={paragraph.highlights.map((h) => ({
                    start: h.startOffset,
                    end: h.endOffset,
                    className: highlightClassName(h.role),
                  }))}
                />
              ))}
              {paragraphs.length === 0 && (
                <p className="text-sm opacity-50">This work has no ingested text yet.</p>
              )}
            </div>
          </div>
        </SelectionHighlighter>

        <div className="flex w-16 flex-none flex-col items-center gap-6 py-8">
          {POSTURES.map((posture, i) => (
            <span
              key={posture}
              className="text-[11.5px] tracking-wide [writing-mode:vertical-rl]"
              style={i === 0 ? { color: "var(--color-bg)", background: "var(--color-accent)", borderRadius: 999, padding: "14px 7px" } : { opacity: 0.6 }}
            >
              {posture}
            </span>
          ))}
        </div>

        <div className="flex w-[428px] flex-none flex-col px-8 pt-8">
          <span className="font-heading text-base">Today's page</span>
          {highlights.length === 0 ? (
            <p className="mt-4 text-sm opacity-50">Nothing kept here yet.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {highlights.map((h) => (
                <li key={h.id} className="rounded-[22px] bg-bg p-4">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-2-700)]">
                    {h.locator}
                  </div>
                  <div className="font-reading text-[13.5px] leading-[1.65]">{h.text}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
