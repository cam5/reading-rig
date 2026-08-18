import { Form, redirect } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { checkRateLimit, getClientIp } from "~/auth/rateLimit.server";
import { parseEpub } from "~/domain/epub/parseEpub";
import { persistWork } from "~/domain/epub/persistWork.server";
import { track } from "~/analytics.server";
import type { Route } from "./+types/upload";

// Generous relative to real EPUBs (a few MB even with cover art), but low
// enough to bound the worst case before parseEpub's own decompression-size
// guard (see unzipWithSizeCap in parseEpub.ts) ever runs.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Same two-bucket shape as auth.login.tsx's login rate limit, guarding
// CPU-costly parsing/decompression rather than a scarce resource — windows
// generous enough that a real person adding a few books in a sitting never
// notices.
const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const USER_UPLOAD_RATE_LIMIT = 10;
const IP_UPLOAD_RATE_LIMIT = 20;

export function meta() {
  return [{ title: "Add a book — Reading Rig" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);

  const withinUserLimit = checkRateLimit(
    `upload:user:${user.id}`,
    USER_UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_LIMIT_WINDOW_MS,
  );
  const withinIpLimit = checkRateLimit(
    `upload:ip:${getClientIp(request)}`,
    IP_UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_LIMIT_WINDOW_MS,
  );
  if (!withinUserLimit || !withinIpLimit) {
    return { error: "Too many uploads. Try again in a bit." };
  }

  const formData = await request.formData();

  // Checked before the file is even read — a book that arrives without
  // this checked isn't ingested at all, not just flagged after the fact.
  if (formData.get("consent") !== "on") {
    return {
      error: "Check the box confirming you have the right to share this file.",
    };
  }

  const file = formData.get("epub");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an EPUB file to upload." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "That file is too large (25MB max)." };
  }

  const startedAt = Date.now();
  const sourceBytes = Buffer.from(await file.arrayBuffer());

  let work;
  try {
    work = parseEpub(sourceBytes);
  } catch {
    // parseEpub only deliberately throws one specific Error (a missing
    // <rootfile full-path>) — anything else malformed can throw a raw
    // TypeError from partway through the DOM walk. Catch broadly; a
    // reader doesn't need to know which, just that it didn't work.
    return { error: "That didn't parse as an EPUB." };
  }

  const result = await persistWork(db, user.id, work);

  // persistWork's upsert only sets ownerId on create — if this exact book
  // (same bytes, hence the same content-addressed Work.id — see
  // deriveWorkId/hashEdition in parseEpub.ts) already exists under someone
  // else's account, this uploader still needs their own access. Same
  // idempotent upsert-against-the-unique-constraint pattern
  // grantSeedWorks.server.ts uses for seed-library grants.
  await db.workGrant.upsert({
    where: { userId_workId: { userId: user.id, workId: result.workId } },
    create: { userId: user.id, workId: result.workId },
    update: {},
  });

  await track(
    {
      name: "epub_ingested",
      workId: result.workId,
      title: work.title,
      chapterCount: result.chapterCount,
      paragraphCount: result.paragraphCount,
      footnoteCount: result.footnoteCount,
      durationMs: Date.now() - startedAt,
      warningCount: result.warnings.length,
      sourceBytes: sourceBytes.byteLength,
      source: "upload",
    },
    { distinctId: user.id },
  );

  return redirect(`/read/${result.workId}`);
}

export default function Upload({ actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-heading text-xl">Add a book</h1>
      <p className="mt-2 text-sm opacity-60">EPUB files, up to 25MB.</p>
      <Form
        method="post"
        encType="multipart/form-data"
        className="mt-6 flex flex-col gap-4"
      >
        <div className="field">
          <label htmlFor="epub">EPUB file</label>
          <input
            className="input"
            id="epub"
            name="epub"
            type="file"
            accept=".epub,application/epub+zip"
            required
          />
        </div>
        <label className="flex items-start gap-2 text-sm opacity-70">
          <input type="checkbox" name="consent" required className="mt-0.5" />
          <span>
            I won't upload a copyrighted work I don't have the right to share.
          </span>
        </label>
        {actionData?.error && (
          <p className="text-sm text-red-600">{actionData.error}</p>
        )}
        <button className="btn btn-primary btn-block" type="submit">
          Add to shelf
        </button>
      </Form>
    </main>
  );
}
