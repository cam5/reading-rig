// Lighthouse CI budgets. Run locally with:
//
//   npm run build && npx prisma migrate deploy && npm run db:seed && \
//     npm run ingest -- app/domain/epub/__fixtures__/capital-volume-i.epub && \
//     npm run ingest -- app/domain/epub/__fixtures__/pride-and-prejudice.epub && \
//     npx lhci autorun
//
// Same bootstrap .github/workflows/lighthouse.yml runs in CI — kept as
// explicit steps there and here rather than delegated to `npm run release`
// (scripts/release.ts), since that script's job is Railway's prod/PR-env
// split, not "set up a fresh local dev.db."
//
// `.cjs` and not `.js`: package.json is `"type": "module"`, and @lhci/cli
// loads a `.js` rc file with a bare `require()`. Under ESM that returns a
// module namespace object, whose `.ci` key lhci then never finds — it
// silently falls through to autodetecting a static site and fails. `.cjs`
// is in lhci's own filename search list and sidesteps the whole thing.

const Database = require("better-sqlite3");

// The built server reads DATABASE_URL straight off the environment
// (app/db.server.ts) — nothing in the request path loads .env, only the
// Prisma CLI and the seed scripts do via prisma.config.ts. So the URL has
// to be threaded into startServerCommand explicitly. Default matches
// .env.example.
const DATABASE_URL = process.env.DATABASE_URL || "file:./dev.db";
const SQLITE_PATH = DATABASE_URL.replace(/^file:/, "");
const PORT = 3000;

/**
 * The seeded work with the most paragraphs, read out of dev.db rather than
 * hardcoded.
 *
 * A Work id is content-addressed — `deriveWorkId(identifier)@hashEdition(bytes)`,
 * e.g. "jane-austen/pride-and-prejudice@377c8b796227" (parseEpub.ts). That
 * hash is a sha256 of the fixture's bytes, so it's stable in CI but changes
 * the moment either fixture EPUB is re-exported. Hardcoding it would mean a
 * re-exported fixture silently turns this into an audit of the 404 page —
 * which would pass every budget below and report the reading column as
 * having gotten dramatically faster. Reading the id back out of the DB makes
 * that failure mode impossible.
 *
 * Most paragraphs, specifically, because the reading column is the surface
 * worth watching: read.tsx's loader ships every paragraph of the work and
 * useVirtualizedRows mounts only a window of them. Pride and Prejudice
 * (~2000 paragraphs) exercises that; the Capital fixture (8) would not.
 */
function heaviestSeededWorkId() {
  const db = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare(
        `SELECT w.id AS id, COUNT(p.id) AS paragraphs
           FROM Work w
           JOIN Chapter c ON c.workId = w.id
           JOIN Section s ON s.chapterId = c.id
           JOIN Paragraph p ON p.sectionId = s.id
          GROUP BY w.id
          ORDER BY paragraphs DESC, w.id ASC
          LIMIT 1`,
      )
      .get();

    if (!row) {
      throw new Error(
        `No works found in ${SQLITE_PATH}. Run the migrate/seed/ingest bootstrap in the comment above this file first.`,
      );
    }

    return row.id;
  } finally {
    db.close();
  }
}

const KB = 1024;

// Two tiers of budget, deliberately.
//
// The byte budgets, CLS and TBT below are the real gate. Transfer sizes are
// deterministic — the same commit produces the same bytes on any machine —
// so they can be held close to the current measurement without ever flaking,
// and they're what actually catches the regressions this repo cares about: a
// dependency landing in the client bundle, or the reading column starting to
// ship more per paragraph.
//
// The time-based ceilings (LCP, FCP, and the category score they dominate)
// are sanity limits, not targets. They're set loose on purpose:
//
//   1. They vary with runner hardware, and these numbers were established on
//      a local machine — GitHub's runners are slower, and no first-party
//      measurement of them existed when this landed.
//   2. Under Lighthouse's default mobile emulation, LCP here is dominated by
//      a third-party critical chain that has nothing to do with app code:
//      styles/organic.css `@import`s Google Fonts, so the LCP element (the
//      first reading paragraph) waits on stylesheet -> imported stylesheet ->
//      an ~86KB Literata woff2 from gstatic. Self-hosting or preloading those
//      fonts would move LCP far more than anything in the reading column
//      would. Until that happens, a tight LCP budget would just fail every PR
//      for a reason no PR caused.
//
// If the first CI runs prove flaky, loosen the time ceilings and score
// floors — not the byte budgets.
//
// Mobile emulation (Lighthouse's default) is kept rather than the desktop
// preset: its 4x CPU throttling is what surfaces the interaction- and
// scroll-smoothness regressions the virtualized reading column was built to
// avoid, which is the whole reason this budget exists.
//
// Observed medians when this landed, for reference:
//
//                       /      /read/:workId
//   LCP              2.9s               5.2s
//   FCP              2.9s               5.0s
//   TBT               0ms                0ms
//   CLS                 0                  0
//   script        103.0KB            172.0KB
//   document        2.4KB            337.0KB
//   stylesheet      6.7KB              6.7KB
//   font           40.1KB            123.9KB
//   total         152.7KB            640.1KB
//   perf score       0.90               0.68

/** Applies to every audited URL — no route gets to shift layout or grow the stylesheet. */
const sharedAssertions = {
  "cumulative-layout-shift": ["error", { maxNumericValue: 0.05 }],
  // Well under the generic 100KB budget: one Tailwind stylesheet serves the
  // whole app, so this only moves if something new starts shipping CSS.
  "resource-summary:stylesheet:size": ["error", { maxNumericValue: 16 * KB }],
};

module.exports = {
  ci: {
    collect: {
      // `npm run start` is just `react-router-serve` — no db bootstrap of
      // its own. The migrate/seed/ingest steps above (this file's header
      // comment; .github/workflows/lighthouse.yml in CI) already ran once
      // before this config was even loaded, since heaviestSeededWorkId()
      // above reads the seeded db at config-load time.
      startServerCommand: `DATABASE_URL="${DATABASE_URL}" npm run start`,
      startServerReadyPattern: "http://localhost",
      url: [
        `http://localhost:${PORT}/`,
        `http://localhost:${PORT}/read/${heaviestSeededWorkId()}`,
      ],
      // Three runs, asserted on the median (see aggregationMethod below).
      numberOfRuns: 3,
      settings: { onlyCategories: ["performance"] },
    },

    assert: {
      // Per-URL, because the two routes are not remotely comparable: home is
      // a short list, the reading route ships an entire novel's paragraphs in
      // its document payload.
      //
      // aggregationMethod is repeated per entry rather than set once above:
      // lhci rejects assertMatrix combined with any sibling assert option
      // ("Cannot use assertMatrix with other options"). Its default is
      // "optimistic", which for a max-value assertion takes the *best* run —
      // one lucky run would hide a real regression. Median over three runs
      // resists a single outlier in either direction.
      assertMatrix: [
        {
          matchingUrlPattern: `^http://localhost:${PORT}/$`,
          aggregationMethod: "median",
          assertions: {
            ...sharedAssertions,
            "resource-summary:script:size": [
              "error",
              { maxNumericValue: 130 * KB },
            ],
            // Generous against the observed 2.4KB: the home document grows
            // with the shelf, and adding books shouldn't fail a perf check.
            "resource-summary:document:size": [
              "error",
              { maxNumericValue: 16 * KB },
            ],
            "resource-summary:font:size": [
              "error",
              { maxNumericValue: 64 * KB },
            ],
            "resource-summary:total:size": [
              "error",
              { maxNumericValue: 224 * KB },
            ],
            "total-blocking-time": ["error", { maxNumericValue: 150 }],
            "largest-contentful-paint": ["error", { maxNumericValue: 5000 }],
            "first-contentful-paint": ["error", { maxNumericValue: 5000 }],
            "categories:performance": ["error", { minScore: 0.7 }],
          },
        },
        {
          matchingUrlPattern: "/read/",
          aggregationMethod: "median",
          assertions: {
            ...sharedAssertions,
            // ~38KB over the observed 172KB. read.tsx is the file #64 wants
            // to decompose; this is the number that notices if that
            // decomposition pulls something heavy into the client bundle.
            "resource-summary:script:size": [
              "error",
              { maxNumericValue: 210 * KB },
            ],
            // The whole work's paragraphs, server-rendered into the document.
            // The most load-bearing budget here: it moves if the loader
            // starts sending more per paragraph.
            "resource-summary:document:size": [
              "error",
              { maxNumericValue: 400 * KB },
            ],
            "resource-summary:font:size": [
              "error",
              { maxNumericValue: 150 * KB },
            ],
            "resource-summary:total:size": [
              "error",
              { maxNumericValue: 768 * KB },
            ],
            // Observed 0ms — hydrating ~2000 paragraphs' worth of loader data
            // costs nothing today because only a window of them is ever
            // mounted as real DOM. This is the assertion that fails if that
            // stops being true.
            "total-blocking-time": ["error", { maxNumericValue: 250 }],
            "largest-contentful-paint": ["error", { maxNumericValue: 7000 }],
            "first-contentful-paint": ["error", { maxNumericValue: 7000 }],
            "categories:performance": ["error", { minScore: 0.5 }],
          },
        },
      ],
    },

    // Stateless: reports land on disk and get uploaded as a build artifact by
    // the workflow. No LHCI server, no temporary-public-storage — a fixed
    // budget is enough to catch a regression, and trend history isn't worth
    // infra to stand up until "how has this trended" is an actual question.
    upload: { target: "filesystem", outputDir: ".lighthouseci" },
  },
};
