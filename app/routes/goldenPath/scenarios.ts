import { FIXTURE } from "./harness";

/**
 * The golden path, as data: one reader's whole happy path through the
 * browser-facing app, from signed out to signed out again. recorder.ts
 * runs these; ../goldenPath.smoke.test.ts compares what comes back with
 * the committed recordings in ./recordings/.
 *
 * Scenarios are chapters of one journey, not independent cases — they
 * run in this order against one database and one cookie jar, so "open a
 * book" is signed in because "sign in" ran before it. That's the point
 * of a golden path (it is the sequence a real reader goes through), and
 * it's also why a single scenario can't be run on its own.
 *
 * Each page a reader sees is recorded twice where there's a JSON
 * counterpart: the HTML route (status, <title>, a few landmark strings —
 * all a server-rendered page can be held to without a browser) and its
 * /api/v1 twin (the full response shape). The two share a domain-layer
 * fetch (see app/routes.ts), so together they pin both "the page
 * renders" and "the data under it has this shape".
 */
export type Step = {
  /** What the reader is doing, in the recording and in failure output. */
  label: string;
  method: "GET" | "POST";
  /**
   * May reference a value an earlier step captured, as `{name}` — the
   * only ids not known up front are the ones the server mints.
   */
  path: string;
  form?: Record<string, string>;
  headers?: Record<string, string>;
  /** Asserted by the test itself, independently of the recording. */
  expectStatus: number;
  /**
   * JSON responses: dot-paths whose literal value is recorded, on top of
   * the response's shape. Only for values that are stable by
   * construction (fixture ids, enum members) — never dates.
   */
  literals?: string[];
  /** HTML responses: strings whose presence is recorded and asserted. */
  landmarks?: string[];
  /** JSON responses: `name` → dot-path, for a later step's `{name}`. */
  capture?: Record<string, string>;
};

export type Scenario = { name: string; steps: Step[] };

const [p1, p2] = FIXTURE.paragraphIds;
const readPath = `/read/${FIXTURE.workId}`;
const apiReadPath = `/api/v1/read/${FIXTURE.workId}`;
const readContentPath = `/api/v1/read-content?work=${encodeURIComponent(FIXTURE.workId)}&min=1&max=3`;

// The form fields below are handleReadAction.server.ts's own — `intent`
// plus whatever that intent's handler reads off the FormData.
export const scenarios: Scenario[] = [
  {
    name: "01-signed-out",
    steps: [
      {
        label: "the shelf sends a signed-out reader to sign in",
        method: "GET",
        path: "/",
        expectStatus: 302,
      },
      {
        label: "the sign-in page renders",
        method: "GET",
        path: "/auth/login?redirectTo=%2F",
        expectStatus: 200,
        landmarks: ["Send magic link"],
      },
      {
        label: "the JSON API refuses rather than redirects",
        method: "GET",
        path: "/api/v1/home",
        expectStatus: 401,
        literals: ["error"],
      },
    ],
  },
  {
    name: "02-sign-in",
    steps: [
      {
        label: "following the emailed link starts a session",
        method: "GET",
        path: `/auth/verify?token=${FIXTURE.magicLinkToken}`,
        expectStatus: 302,
      },
      {
        label: "the same link does not work twice",
        method: "GET",
        path: `/auth/verify?token=${FIXTURE.magicLinkToken}`,
        expectStatus: 200,
        landmarks: ["That link has already been used"],
      },
      {
        label: "a signed-in reader is bounced off the sign-in page",
        method: "GET",
        path: "/auth/login",
        expectStatus: 302,
      },
    ],
  },
  {
    name: "03-shelf",
    steps: [
      {
        label: "the shelf lists the book",
        method: "GET",
        path: "/",
        expectStatus: 200,
        landmarks: [
          FIXTURE.workTitle,
          FIXTURE.workAuthor,
          `href="${readPath}"`,
        ],
      },
      {
        label: "the shelf, as JSON",
        method: "GET",
        path: "/api/v1/home",
        expectStatus: 200,
        literals: ["userId", "works.0.id", "works.0.title"],
      },
    ],
  },
  {
    name: "04-open-book",
    steps: [
      {
        label: "the reading page renders",
        method: "GET",
        path: readPath,
        expectStatus: 200,
        landmarks: [FIXTURE.workTitle],
      },
      {
        label: "the reading page's data, with no bookmark yet",
        method: "GET",
        path: apiReadPath,
        expectStatus: 200,
        literals: ["work.id", "work.title", "isResume"],
      },
      {
        label: "the content window",
        method: "GET",
        path: readContentPath,
        expectStatus: 200,
        literals: ["paragraphs.0.id", "paragraphs.2.id"],
      },
    ],
  },
  {
    name: "05-bookmark",
    steps: [
      {
        // The page route's own action, not /api/v1's — the one write in
        // this path that goes through read.tsx itself, so a dropped
        // `action` export there (c05fea7's failure mode, for the loader)
        // fails here.
        label: "the bookmark follows the reader to the second paragraph",
        method: "POST",
        path: readPath,
        form: { intent: "bookmark", paragraphId: p2 },
        expectStatus: 200,
        landmarks: [FIXTURE.workTitle],
      },
      {
        label: "opening the book again resumes there",
        method: "GET",
        path: apiReadPath,
        expectStatus: 200,
        literals: ["isResume", "bookmarkGlobalOrdinal"],
      },
    ],
  },
  {
    name: "06-highlight-and-note",
    steps: [
      {
        label: "a highlight in the first paragraph",
        method: "POST",
        path: apiReadPath,
        form: {
          intent: "highlight",
          spans: JSON.stringify([{ paragraphId: p1, start: 4, end: 19 }]),
        },
        expectStatus: 200,
        literals: ["ok"],
      },
      {
        label: "a note on a fresh selection, bundled with its highlight",
        method: "POST",
        path: apiReadPath,
        form: {
          intent: "highlight-note",
          spans: JSON.stringify([{ paragraphId: p2, start: 4, end: 20 }]),
          body: "A note kept from the golden path.",
          excerpt: "second paragraph",
        },
        expectStatus: 200,
        literals: ["ok"],
      },
      {
        label: "a note with no body is refused",
        method: "POST",
        path: apiReadPath,
        form: {
          intent: "highlight-note",
          spans: JSON.stringify([{ paragraphId: p2, start: 0, end: 3 }]),
          body: "   ",
        },
        expectStatus: 400,
      },
      {
        label: "the content window now carries both marks and the note",
        method: "GET",
        path: readContentPath,
        expectStatus: 200,
        literals: [
          "paragraphs.0.highlightSpans.0.highlight.role",
          "paragraphs.0.highlightSpans.0.startOffset",
          "paragraphs.0.highlightSpans.0.endOffset",
          "paragraphs.1.highlightSpans.0.highlight.role",
          "paragraphs.1.entries.0.body",
          "paragraphs.1.entries.0.origin",
        ],
      },
    ],
  },
  {
    name: "07-commonplace",
    steps: [
      {
        label: "the commonplace book, as JSON, holds the note",
        method: "GET",
        path: "/api/v1/commonplace",
        expectStatus: 200,
        literals: [
          "totalEntries",
          "totalWorks",
          "readingHref",
          "entries.0.body",
          "entries.0.origin",
          "entries.0.excerpt",
          "entries.0.locator",
        ],
        capture: { entryId: "entries.0.id" },
      },
      {
        label: "the commonplace page shows it",
        method: "GET",
        path: "/commonplace",
        expectStatus: 200,
        landmarks: ["A note kept from the golden path.", "Commonplace"],
      },
      {
        label: "the entry's own page",
        method: "GET",
        path: "/commonplace/{entryId}",
        expectStatus: 200,
        landmarks: ["A note kept from the golden path.", "Open at the passage"],
      },
      {
        label: "the entry, as JSON",
        method: "GET",
        path: "/api/v1/commonplace/{entryId}",
        expectStatus: 200,
        literals: ["entry.body", "entry.origin", "entry.locator"],
      },
    ],
  },
  {
    name: "08-sign-out",
    steps: [
      {
        label: "signing out clears the session",
        method: "POST",
        path: "/auth/logout",
        expectStatus: 302,
      },
      {
        label: "the shelf is behind sign-in again",
        method: "GET",
        path: "/",
        expectStatus: 302,
      },
      {
        label: "and so is the book",
        method: "GET",
        path: readPath,
        expectStatus: 302,
      },
    ],
  },
];
