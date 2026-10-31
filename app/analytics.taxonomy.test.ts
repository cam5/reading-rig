import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  CLIENT_ANALYTICS_EVENT_NAMES,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from "./analytics.server";

// The naming conventions in `AnalyticsEvent`'s doc comment, as assertions
// rather than prose. The `Record` below is what makes this cover a new
// event automatically: adding one to the catalog is a compile error here
// until it gets a sample, and then the sample is checked like every other.
const SAMPLES = {
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
  highlight_created: {
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
  },
  note_created: {
    name: "note_created",
    workId: "work-1",
    locator: "§4 ¶3",
    origin: "rig",
    hasHighlightRef: true,
    hasExcerpt: true,
    bodyLength: 56,
    excerptLength: 46,
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
    sessionCount: 3,
  },
  rig_message_sent: {
    name: "rig_message_sent",
    workId: "work-1",
    messageLength: 80,
    hasExplicitSession: false,
  },
  section_navigated: {
    name: "section_navigated",
    workId: "work-1",
    delta: 3,
    fromChapterOrdinal: 1,
    fromSectionOrdinal: 4,
    toChapterOrdinal: 1,
    toSectionOrdinal: 7,
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
    title: "Pride and Prejudice",
    chapterCount: 61,
    paragraphCount: 2400,
    footnoteCount: 0,
    durationMs: 812,
    warningCount: 0,
    sourceBytes: 400_000,
    source: "cli",
  },
  signed_up: { name: "signed_up", hasRedirectTo: false },
  signed_in: { name: "signed_in", hasRedirectTo: true },
} satisfies {
  [Name in AnalyticsEventName]: Extract<AnalyticsEvent, { name: Name }>;
};

const EVENT_NAME = /^[a-z]+(_[a-z]+)+$/;
const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

// Most past tenses end in `ed`; a phrasal one (`signed_in`) is checked on
// the verb before its particle. An irregular verb is listed here, on purpose.
const PAST_TENSE_EXCEPTIONS = new Set<string>(["sent"]);

function endsInPastTenseVerb(name: string): boolean {
  if (/_(in|up)$/.test(name)) return /ed_(in|up)$/.test(name);
  const verb = name.slice(name.lastIndexOf("_") + 1);
  return verb.endsWith("ed") || PAST_TENSE_EXCEPTIONS.has(verb);
}

// Keys that would carry the words themselves (or an inbox address) rather
// than a length — the header's privacy rule.
const FORBIDDEN_KEYS = ["text", "body", "excerpt", "message", "email"];

describe("event names", () => {
  it.each(ANALYTICS_EVENT_NAMES)("%s is snake_case object_verb", (name) => {
    expect(name).toMatch(EVENT_NAME);
  });

  it.each(ANALYTICS_EVENT_NAMES)("%s ends in a past-tense verb", (name) => {
    expect(endsInPastTenseVerb(name)).toBe(true);
  });

  it("has no duplicates", () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(
      ANALYTICS_EVENT_NAMES.length,
    );
  });

  it("whitelists only catalog names for the beacon", () => {
    for (const name of CLIENT_ANALYTICS_EVENT_NAMES) {
      expect(ANALYTICS_EVENT_NAMES).toContain(name);
    }
  });
});

describe("event properties", () => {
  it("has a sample for exactly the catalog's names", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(
      [...ANALYTICS_EVENT_NAMES].sort(),
    );
  });

  it.each(Object.values(SAMPLES))(
    "$name uses camelCase keys and no text or PII",
    (event: AnalyticsEvent) => {
      const { name: _name, ...properties } = event;
      for (const key of Object.keys(properties)) {
        expect(key).toMatch(CAMEL_CASE);
        expect(FORBIDDEN_KEYS).not.toContain(key);
      }
    },
  );
});
