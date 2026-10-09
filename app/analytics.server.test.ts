import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsClientFor,
  analyticsEnabled,
  canonicalRequestUrl,
  shutdownAnalytics,
  track,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from "./analytics.server";

// posthog-node stands in for itself here: these tests are about the seam
// (does it construct a client at all, with what options, carrying what
// properties), not about the SDK's own batching. Nothing here talks to a
// network, and none of it needs a real PostHog project.
const { constructions, capture, shutdown } = vi.hoisted(() => ({
  constructions: [] as Array<{
    apiKey: string;
    options: Record<string, unknown>;
  }>,
  capture: vi.fn(),
  shutdown: vi.fn(async () => {}),
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = capture;
    shutdown = shutdown;
    constructor(apiKey: string, options: Record<string, unknown>) {
      constructions.push({ apiKey, options });
    }
  },
}));

const HIGHLIGHT: AnalyticsEvent = {
  name: "highlight_created",
  workId: "work-1",
  locator: "§4 ¶2–3",
  role: "hand",
  textLength: 120,
  paragraphCount: 2,
  sectionOrdinal: 4,
  chapterOrdinal: 1,
  spansSections: false,
  withNote: false,
};

// What a call site would be holding when it builds an event from something
// the reader wrote or selected: every length below is derived from one of
// these, the way handleReadAction.server.ts derives `bodyLength` from a
// note's body, so the catalog-wide test further down can assert the words
// themselves never came along.
const SENTINEL = "zxqv-private-marginalia-zxqv";
const SENTINEL_EMAIL = "reader@example.com";

// One of every event, keyed by name — the mapped type makes a new
// AnalyticsEvent variant a compile error here until it has a sample, so the
// privacy assertions can't silently skip it.
const EVERY_EVENT: {
  [Name in AnalyticsEventName]: Extract<AnalyticsEvent, { name: Name }>;
} = {
  work_opened: {
    name: "work_opened",
    workId: "work-1",
    title: "Capital, Volume I",
    startingOrdinal: 40,
    isResume: true,
    isDeepLink: false,
    bookmarkGlobalOrdinal: 40,
    progressPercent: 12,
    totalParagraphs: 340,
    chapterCount: 33,
  },
  highlight_created: { ...HIGHLIGHT, textLength: SENTINEL.length },
  note_created: {
    name: "note_created",
    workId: "work-1",
    locator: "§4 ¶3",
    origin: "hand",
    hasHighlightRef: true,
    hasExcerpt: true,
    bodyLength: SENTINEL.length,
    excerptLength: SENTINEL.length,
    sectionOrdinal: 4,
    chapterOrdinal: 1,
  },
  bookmark_updated: {
    name: "bookmark_updated",
    workId: "work-1",
    globalOrdinal: 40,
    progressPercent: 12,
    totalParagraphs: 340,
    sectionOrdinal: 4,
    chapterOrdinal: 1,
  },
  rig_session_started: {
    name: "rig_session_started",
    workId: "work-1",
    sessionCount: 1,
  },
  rig_session_switched: {
    name: "rig_session_switched",
    workId: "work-1",
    sessionCount: 2,
  },
  rig_message_sent: {
    name: "rig_message_sent",
    workId: "work-1",
    messageLength: SENTINEL.length,
    hasExplicitSession: false,
  },
  section_navigated: {
    name: "section_navigated",
    workId: "work-1",
    delta: 1,
    fromChapterOrdinal: 1,
    fromSectionOrdinal: 3,
    toChapterOrdinal: 1,
    toSectionOrdinal: 4,
  },
  rig_opened: {
    name: "rig_opened",
    workId: "work-1",
    source: "selection",
    hasContext: true,
  },
  epub_ingested: {
    name: "epub_ingested",
    workId: "work-1",
    title: "Capital, Volume I",
    chapterCount: 33,
    paragraphCount: 340,
    footnoteCount: 0,
    durationMs: 812,
    warningCount: 0,
    sourceBytes: 400_000,
    source: "upload",
  },
  signed_up: { name: "signed_up", hasRedirectTo: false },
  signed_in: { name: "signed_in", hasRedirectTo: true },
};

// Property names that would mean a call site is passing the thing itself
// rather than a measurement of it — a whole key, or one ending in the bare
// noun: `body`, `noteText`, `userEmail`. `bodyLength` doesn't end in one,
// and a `has…`/`is…`/`with…` flag (`hasExcerpt`, `withNote`) is exempted up
// front, since the value check below already holds it to a boolean.
const CONTENT_KEY_PATTERN =
  /^(?!(has|is|with)[A-Z])(\w*(Body|Text|Excerpt|Message|Content|Html|Note|Email|Query|Prompt|Token|Filename)|body|text|excerpt|message|content|html|note|email|query|prompt|token|filename)$/;

// Every string-valued property the catalog sends today, each an id, an enum
// or a derived label rather than anything a reader typed or selected. The
// two a privacy policy still has to disclose are `title`/`$screen_name` (a
// book's title, including an uploaded one) — see docs/privacy-audit.md.
const NON_CONTENT_STRING_KEYS = [
  "workId",
  "title",
  "locator",
  "role",
  "origin",
  "source",
  "client",
  "$current_url",
  "$pathname",
  "$host",
  "$screen_name",
];

const EMAIL_PATTERN = /[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i;

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete process.env.POSTHOG_PROJECT_API_KEY;
  delete process.env.POSTHOG_HOST;
  constructions.length = 0;
  capture.mockReset();
  shutdown.mockClear();
  // Nothing in this module should ever reach the network directly; any
  // call at all is a failure, so fail loudly rather than let one through.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("analytics must not make a network call in these tests");
  });
});

afterEach(async () => {
  // Doubles as the reset: shutdownAnalytics() drops the cached client, so
  // the next test constructs its own.
  await shutdownAnalytics();
  fetchSpy.mockRestore();
});

describe("without a project key", () => {
  it("reports itself as off", () => {
    expect(analyticsEnabled()).toBe(false);
  });

  it("no-ops rather than throwing", async () => {
    await expect(
      track(HIGHLIGHT, { distinctId: "local-user", client: "web" }),
    ).resolves.toBeUndefined();
  });

  it("never constructs a client or touches the network", async () => {
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    await track(
      {
        name: "bookmark_updated",
        workId: "work-1",
        globalOrdinal: 40,
        progressPercent: 12,
        totalParagraphs: 340,
        sectionOrdinal: 4,
        chapterOrdinal: 1,
      },
      { distinctId: "local-user", client: "web" },
    );

    // Not "captured and dropped" — the SDK is never even reached, which
    // is what makes dev, `npm test` and CI need no PostHog project at all.
    expect(constructions).toHaveLength(0);
    expect(capture).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays a no-op on shutdown, so a CLI can call it unconditionally", async () => {
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    await expect(shutdownAnalytics()).resolves.toBeUndefined();
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe("with a project key", () => {
  beforeEach(() => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_key";
  });

  it("reports itself as on", () => {
    expect(analyticsEnabled()).toBe(true);
  });

  it("captures the event name and every property, under the user's id", async () => {
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      distinctId: "local-user",
      event: "highlight_created",
      properties: {
        workId: "work-1",
        locator: "§4 ¶2–3",
        role: "hand",
        textLength: 120,
        paragraphCount: 2,
        sectionOrdinal: 4,
        chapterOrdinal: 1,
        spansSections: false,
        withNote: false,
        client: "web",
      },
    });
  });

  it("does not send the event name twice, as a property as well", async () => {
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    expect(capture.mock.calls[0][0].properties).not.toHaveProperty("name");
  });

  it("constructs one client for many events", async () => {
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    expect(constructions).toHaveLength(1);
    expect(constructions[0].apiKey).toBe("phc_test_key");
  });

  it("turns off the one thing posthog-node would capture without a call site", async () => {
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    // #78's explicit "no", written down rather than left to a default.
    expect(constructions[0].options.enableExceptionAutocapture).toBe(false);
    expect(constructions[0].options.disableGeoip).toBe(true);
  });

  it("defaults to PostHog Cloud US and honours POSTHOG_HOST", async () => {
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    expect(constructions[0].options.host).toBe("https://us.i.posthog.com");

    await shutdownAnalytics();
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    await track(HIGHLIGHT, { distinctId: "local-user", client: "web" });
    expect(constructions[1].options.host).toBe("https://eu.i.posthog.com");
  });

  it("flushes on shutdown, for callers with no request lifecycle", async () => {
    await track(
      {
        name: "epub_ingested",
        workId: "work-1",
        title: "Pride and Prejudice",
        chapterCount: 61,
        paragraphCount: 2400,
        footnoteCount: 0,
        durationMs: 812,
        warningCount: 0,
        sourceBytes: 400_000,
        source: "cli",
      },
      { distinctId: "local-user", client: "web" },
    );

    await shutdownAnalytics();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("swallows a capture failure — analytics must never fail a save", async () => {
    capture.mockImplementation(() => {
      throw new Error("posthog is down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      track(HIGHLIGHT, { distinctId: "local-user", client: "web" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // The privacy rule from #78, as an assertion rather than a comment: a
  // note's event carries how long it was and where it sits, never what it
  // said. Highlighted and written text must not reach a third party.
  it("carries lengths and locators, never the words themselves", async () => {
    const body = "Marx is doing something quite specific with 'congealed'.";
    const excerpt = "a mere congelation of homogeneous human labour";

    await track(
      {
        name: "note_created",
        workId: "work-1",
        locator: "§4 ¶3",
        origin: "hand",
        hasHighlightRef: true,
        hasExcerpt: true,
        bodyLength: body.length,
        excerptLength: excerpt.length,
        sectionOrdinal: 4,
        chapterOrdinal: 1,
      },
      { distinctId: "local-user", client: "web" },
    );

    const payload = JSON.stringify(capture.mock.calls[0][0]);
    expect(payload).not.toContain(body);
    expect(payload).not.toContain(excerpt);
    expect(payload).not.toContain("congealed");
    expect(capture.mock.calls[0][0].properties).toMatchObject({
      bodyLength: 56,
      excerptLength: 46,
    });
  });

  // The same rule, across the whole catalog rather than one event: nothing
  // `track()` hands PostHog may be shaped like it could carry a note, a
  // highlight, a Rig message or an email address. A new string property
  // fails here until it's added to NON_CONTENT_STRING_KEYS on purpose.
  describe.each(Object.values(EVERY_EVENT))("$name", (event) => {
    it("sends no content-shaped key, free text, or email", async () => {
      await track(event, {
        distinctId: "user-cuid-1",
        currentUrl: "https://reading-rig.com/read/work-1?section=s-4",
        screenName: "Capital, Volume I — Reading Rig",
        client: "web",
      });

      const sent = capture.mock.calls[0][0];
      for (const [key, value] of Object.entries(sent.properties)) {
        expect(key).not.toMatch(CONTENT_KEY_PATTERN);
        if (/^(has|is|with)[A-Z]/.test(key)) {
          expect(typeof value).toBe("boolean");
        } else if (typeof value === "string") {
          expect(NON_CONTENT_STRING_KEYS).toContain(key);
        } else {
          expect(["number", "boolean"]).toContain(typeof value);
        }
      }
      const payload = JSON.stringify(sent);
      expect(payload).not.toContain(SENTINEL);
      expect(payload).not.toContain(SENTINEL_EMAIL);
      expect(payload).not.toMatch(EMAIL_PATTERN);
    });
  });
});

describe("canonicalRequestUrl", () => {
  it("drops the magic-link token before the URL can reach an event", () => {
    const request = new Request(
      "https://reading-rig.com/auth/verify?token=abc123&redirectTo=%2Fupload",
    );
    expect(canonicalRequestUrl(request)).toBe(
      "https://reading-rig.com/auth/verify?redirectTo=%2Fupload",
    );
  });

  it("drops mention-search text, which is the reader's own words", () => {
    const request = new Request(
      `https://reading-rig.com/api/v1/mention-suggestions?work=work-1&q=${encodeURIComponent(SENTINEL)}`,
    );
    const url = canonicalRequestUrl(request);
    expect(url).toBe(
      "https://reading-rig.com/api/v1/mention-suggestions?work=work-1",
    );
  });

  it("still corrects the protocol and the .data suffix", () => {
    const request = new Request(
      "http://reading-rig.com/read/work-1.data?section=s-4",
      { headers: { "x-forwarded-proto": "https" } },
    );
    expect(canonicalRequestUrl(request)).toBe(
      "https://reading-rig.com/read/work-1?section=s-4",
    );
  });
});

describe("analyticsClientFor", () => {
  it("reads a Bearer-authenticated request as the iOS app", () => {
    const request = new Request("http://localhost/api/v1/home", {
      headers: { Authorization: "Bearer rig_abc123" },
    });
    expect(analyticsClientFor(request)).toBe("mobile-app-ios");
  });

  it("reads a cookie (no Authorization header) request as web", () => {
    const request = new Request("http://localhost/read/some-work");
    expect(analyticsClientFor(request)).toBe("web");
  });

  it("reads a non-Bearer Authorization scheme as web, not mobile-app-ios", () => {
    const request = new Request("http://localhost/api/v1/home", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(analyticsClientFor(request)).toBe("web");
  });
});

// Type-level, not runtime: `npm run typecheck` compiles this file, so
// these are the "an event that doesn't exist is a compile error, not a
// silently-empty property" claim actually being enforced.
describe("the catalog is typed", () => {
  it("rejects unknown events and missing properties", () => {
    // prettier-ignore
    // @ts-expect-error — no such event in the catalog
    const unknownEvent: AnalyticsEvent = { name: "highlight_deleted", workId: "work-1" };
    // prettier-ignore
    // @ts-expect-error — bookmark_updated needs its ordinals and totals
    const missingProperty: AnalyticsEvent = { name: "bookmark_updated", workId: "work-1" };

    expect([unknownEvent, missingProperty]).toHaveLength(2);
  });
});
