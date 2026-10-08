import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CookieJar,
  FIXTURE,
  createGoldenHarness,
  type GoldenHarness,
} from "./goldenPath/harness";
import {
  recordScenario,
  serialiseRecording,
  type Captures,
} from "./goldenPath/recorder";
import { scenarios } from "./goldenPath/scenarios";

/**
 * Replays the golden path (goldenPath/scenarios.ts) through the real
 * built server and compares each scenario with its committed recording
 * in goldenPath/recordings/. Same no-port, no-browser mechanism as
 * apiV1.smoke.test.ts beside it, and picked up by the same
 * `*.smoke.test.ts` glob — so `npm run test:smoke`, and CI with it,
 * replays these too. `npm run golden:record` rewrites the recordings;
 * see RUNBOOK.md's "Golden paths" for when that's the right thing to do.
 *
 * Where that suite asks "is each /api/v1 route wired at all", this one
 * asks "does the sequence a reader actually goes through still hold
 * together" — signed out, sign in, shelf, open a book, bookmark,
 * highlight and note, commonplace book, sign out — including the cookie
 * session and the HTML page routes, neither of which that suite touches
 * (it runs entirely on session.server.ts's no-cookie dev fallback).
 *
 * A recording alone is only as good as whoever last re-recorded it:
 * `--update` will faithfully commit a 500. So every step's status is
 * also asserted against the scenario's own `expectStatus`, every HTML
 * landmark has to be present, and each write is checked against the
 * database directly (`sideEffects` below) — none of which `--update`
 * can rewrite.
 */

let harness: GoldenHarness;
// One jar and one set of captures for the whole journey — scenarios are
// chapters of one reader's session, not independent cases.
const jar = new CookieJar();
const captures: Captures = new Map();

beforeAll(async () => {
  harness = await createGoldenHarness();
});

afterAll(async () => {
  await harness.close();
});

const [p1, p2] = FIXTURE.paragraphIds;

// What each scenario must have left in the database, keyed by scenario
// name. Read through the harness's own client, straight off the SQLite
// file the server just wrote to.
const sideEffects: Record<string, () => Promise<void>> = {
  "02-sign-in": async () => {
    const tokens = await harness.db.magicLinkToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].consumedAt).not.toBeNull();
    // Signed in as the seeded reader, not signed up as a second one.
    expect(await harness.db.user.count()).toBe(1);
  },
  "05-bookmark": async () => {
    const position = await harness.db.readingPosition.findUnique({
      where: {
        userId_workId: { userId: FIXTURE.userId, workId: FIXTURE.workId },
      },
    });
    expect(position?.paragraphId).toBe(p2);
  },
  "06-highlight-and-note": async () => {
    const highlights = await harness.db.highlight.findMany({
      where: { userId: FIXTURE.userId },
      include: { spans: true, entries: true },
      orderBy: { createdAt: "asc" },
    });
    // Two, not three: the refused empty-body note must not have left its
    // highlight behind.
    expect(highlights).toHaveLength(2);
    const [bare, noted] = highlights;
    expect(bare.role).toBe("hand");
    expect(bare.entries).toHaveLength(0);
    expect(
      bare.spans.map((s) => [s.paragraphId, s.startOffset, s.endOffset]),
    ).toEqual([[p1, 4, 19]]);
    expect(
      noted.spans.map((s) => [s.paragraphId, s.startOffset, s.endOffset]),
    ).toEqual([[p2, 4, 20]]);

    const entries = await harness.db.entry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: FIXTURE.userId,
      origin: "hand",
      body: "A note kept from the golden path.",
      anchorParagraphId: p2,
      highlightId: noted.id,
      contextSnapshot: { excerpt: "second paragraph" },
    });
  },
  "07-commonplace": async () => {
    const entry = await harness.db.entry.findFirstOrThrow();
    expect(captures.get("entryId")).toBe(entry.id);
  },
};

const RECORDINGS_DIR = resolve(import.meta.dirname, "goldenPath/recordings");

describe("golden path", () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const { recording, results } = await recordScenario(
        scenario,
        harness.handler,
        jar,
        captures,
      );

      for (const result of results) {
        expect(result.status, result.step.label).toBe(result.step.expectStatus);
        expect(result.missingLandmarks, result.step.label).toEqual([]);
      }
      await sideEffects[scenario.name]?.();

      await expect(serialiseRecording(recording)).toMatchFileSnapshot(
        resolve(RECORDINGS_DIR, `${scenario.name}.json`),
      );
    });
  }

  // Only the stale direction: file snapshots are written after the run
  // finishes, so a scenario recorded for the first time has no file yet
  // when this runs. A *missing* recording is toMatchFileSnapshot's own
  // failure above (in CI, where vitest won't write one).
  it("has no recording left behind by a renamed or removed scenario", () => {
    const expected = scenarios.map((scenario) => `${scenario.name}.json`);
    const stale = readdirSync(RECORDINGS_DIR).filter(
      (file) => !expected.includes(file),
    );
    expect(stale).toEqual([]);
  });
});
