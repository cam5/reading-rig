import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestHandler, type RequestHandler } from "react-router";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../../generated/prisma/client";
import { TEST_DB_TEMPLATE_PATH } from "../../rig/tools/globalSetupDb";

/**
 * Everything the golden-path suite (../goldenPath.smoke.test.ts) needs to
 * dispatch real Requests at the real built server: a throwaway SQLite
 * copy, a deterministic seed, the build's request handler, and a cookie
 * jar. Same mechanism as apiV1.smoke.test.ts — createRequestHandler
 * against build/server/index.js, no port, no browser — pulled out into a
 * module here because the recorder and the test file both need it.
 *
 * Same rule as that suite, too: nothing here imports db.server.ts or a
 * domain helper. Either would evaluate db.server.ts's singleton inside
 * this test process's own module graph (see apiV1.smoke.test.ts's
 * hashToken comment for the full story), so every fixture below goes
 * through this file's own PrismaClient instead.
 */

// Fixed ids rather than cuids wherever the schema allows one to be set —
// a recording can then name them literally instead of needing a
// placeholder. The work id is slash-shaped on purpose: real Work ids are
// ("karl-marx/capital-volume-i", see app/routes.ts's splat comment), and
// a single-segment id here would never exercise read/*'s splat matching.
export const FIXTURE = {
  userId: "golden-reader",
  email: "golden@reading-rig.invalid",
  workId: "golden-author/the-golden-path",
  workTitle: "The Golden Path",
  workAuthor: "Golden Author",
  paragraphIds: [
    "golden-author/the-golden-path::c1::s1::p1",
    "golden-author/the-golden-path::c1::s1::p2",
    "golden-author/the-golden-path::c1::s1::p3",
  ],
  // Not a secret — a fixture value that only ever matches a row in a
  // database this file created a moment ago. Still redacted from
  // recordings (see recorder.ts's normalise) so a committed recording
  // never carries anything token-shaped.
  magicLinkToken: "golden-path-magic-link-token",
} as const;

const PARAGRAPH_TEXTS = [
  "The first paragraph sets out.",
  "The second paragraph is where the bookmark lands.",
  "The third paragraph waits past it.",
];

// Mirrors magicLink.server.ts's own hashToken — duplicated, not imported,
// for the db.server.ts reason in this file's header.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Carries Set-Cookie across steps the way a browser would, so a scenario
 * can sign in on one request and be signed in on the next. Only as much
 * of a cookie jar as one origin and one session cookie need: no domain,
 * path, or expiry bookkeeping beyond "was this one just cleared".
 */
export class CookieJar {
  private cookies = new Map<string, string>();

  /** What this response did to the jar, for the recording. */
  absorb(response: Response): "set" | "cleared" | "none" {
    let outcome: "set" | "cleared" | "none" = "none";
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";").map((s) => s.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      // destroySession's shape: an empty value with an epoch Expires
      // and/or Max-Age=0.
      const cleared =
        value === "" ||
        attributes.some((attribute) => /^max-age=0$/i.test(attribute)) ||
        attributes.some((attribute) => /^expires=.*\b1970\b/i.test(attribute));
      if (cleared) {
        this.cookies.delete(name);
        outcome = "cleared";
      } else {
        this.cookies.set(name, value);
        outcome = "set";
      }
    }
    return outcome;
  }

  header(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export type GoldenHarness = {
  db: PrismaClient;
  handler: RequestHandler;
  close: () => Promise<void>;
};

// The env this suite overrides, restored by close().
const OVERRIDDEN_ENV = [
  "DATABASE_URL",
  "RAILWAY_ENVIRONMENT_NAME",
  "SESSION_SECRET",
  "POSTHOG_PROJECT_API_KEY",
] as const;

export async function createGoldenHarness(): Promise<GoldenHarness> {
  const dir = mkdtempSync(join(tmpdir(), "reading-rig-golden-"));
  const path = join(dir, "golden.db");
  copyFileSync(TEST_DB_TEMPLATE_PATH, path);
  const db = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${path}` }),
  });

  const previousEnv = Object.fromEntries(
    OVERRIDDEN_ENV.map((name) => [name, process.env[name]]),
  );

  // Set before the server build is imported below — db.server.ts reads
  // DATABASE_URL once, at module-evaluation time.
  process.env.DATABASE_URL = `file:${path}`;
  // The one place this suite departs from apiV1.smoke.test.ts, which
  // leans on session.server.ts's dev fallback (no cookie → the one seeded
  // user). A golden path that starts signed out and ends signed out needs
  // that fallback off, and requiresRealAuth() (env.server.ts) is the
  // switch: it reads this at call time, and with it set a request with no
  // session really is redirected to /auth/login. SESSION_SECRET is
  // required alongside it (session.server.ts throws at module evaluation
  // otherwise), so it has to land before the import too.
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.SESSION_SECRET = "golden-path-session-secret";
  // track() is a no-op without a key (analytics.server.ts). Unset rather
  // than trusted to be absent: a developer's shell exporting one would
  // otherwise have every recorded step report a real event.
  delete process.env.POSTHOG_PROJECT_API_KEY;

  await db.user.create({ data: { id: FIXTURE.userId, email: FIXTURE.email } });
  await db.work.create({
    data: {
      id: FIXTURE.workId,
      ownerId: FIXTURE.userId,
      title: FIXTURE.workTitle,
      author: FIXTURE.workAuthor,
    },
  });
  const chapter = await db.chapter.create({
    data: {
      id: `${FIXTURE.workId}::c1`,
      workId: FIXTURE.workId,
      label: "Chapter 1",
      ordinal: 1,
    },
  });
  const section = await db.section.create({
    data: {
      id: `${chapter.id}::s1`,
      chapterId: chapter.id,
      label: "1",
      ordinal: 1,
    },
  });
  for (const [index, text] of PARAGRAPH_TEXTS.entries()) {
    await db.paragraph.create({
      data: {
        id: FIXTURE.paragraphIds[index],
        sectionId: section.id,
        html: `<p>${text}</p>`,
        text,
        ordinal: index + 1,
        globalOrdinal: index + 1,
        wordCount: text.split(" ").length,
      },
    });
  }
  // What POST /auth/login would have written just before emailing the
  // link — seeded directly, since the raw token it generates is random
  // and only ever leaves the server inside that email.
  await db.magicLinkToken.create({
    data: {
      email: FIXTURE.email,
      tokenHash: hashToken(FIXTURE.magicLinkToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  const build = await import(
    pathToFileURL(
      resolve(import.meta.dirname, "../../../build/server/index.js"),
    ).href
  );
  const handler = createRequestHandler(build, "production");

  return {
    db,
    handler,
    close: async () => {
      await db.$disconnect();
      for (const name of OVERRIDDEN_ENV) {
        if (previousEnv[name] === undefined) delete process.env[name];
        else process.env[name] = previousEnv[name];
      }
    },
  };
}
