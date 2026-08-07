import type { PostHog } from "posthog-node";

/**
 * The one seam anything in this app reports through.
 *
 * Same shape as the plan's decision to write the Rig's tool handlers as
 * plain functions rather than importing an SDK at every call site: PostHog
 * is a swappable detail behind a seam we own, not the interface itself.
 * No route, loader, action or script should ever construct a PostHog
 * client or call `capture()` directly — they call `track()` with one of
 * the events below and know nothing else.
 *
 * Two things this deliberately does not do (#78):
 *
 *  - **No autocapture.** `posthog-node` has no click/pageview autocapture
 *    to inherit, and `enableExceptionAutocapture` (the one thing it does
 *    offer that fires without a call site) is set to `false` explicitly
 *    below rather than left to a default. Every event in this file exists
 *    because someone wrote it down.
 *  - **No session replay.** That lives in `posthog-js`, which this app
 *    does not depend on and should not: recording a video of a personal
 *    reading session is exactly the wrong instinct for this app, and
 *    everything worth tracking today already passes through a server
 *    action or loader anyway.
 *
 * And one thing it never sends: the text of a highlight or a note. A
 * personal reading app's margin is not a third-party analytics payload.
 * Events carry a *length* and a *locator* — enough to ask "are the long
 * notes clustered anywhere" — never the words themselves.
 */

/**
 * Every event the app can report, as one discriminated union: an event
 * name that doesn't exist, or a property left off, is a compile error
 * rather than a silently-empty property in PostHog three weeks later.
 *
 * Properties are deliberately fulsome (#78) — over-capture now rather
 * than re-instrument once a real question shows up. The bar for adding a
 * property is "the call site already has it, or can get it without
 * another query", not "we know what we'd ask of it".
 */
export type AnalyticsEvent =
  /**
   * A work's reading view was loaded. Fired from `read.tsx`'s loader.
   *
   * Once per *loader run*, which is not quite once per "opened the book":
   * React Router revalidates this route's loader after every write to it,
   * so a reading session that keeps moving the bookmark produces a
   * `work_opened` alongside each `bookmark_updated`. Left that way on
   * purpose rather than sniffing the single-fetch request shape to guess
   * which runs were "real" opens — that's a private protocol detail, and
   * a wrong guess would quietly distort the count rather than fail
   * loudly. Read it as "the reading view rendered", and count distinct
   * `startingOrdinal`/`isResume` shapes if you want opens specifically.
   */
  | {
      name: "work_opened";
      workId: string;
      title: string;
      /** Where this load actually lands the reader, in whole-work reading order. */
      startingOrdinal: number;
      /** A bookmark already existed for this work — a resume, not a fresh start. */
      isResume: boolean;
      /** Arrived via an explicit `?section=` deep link rather than the work's top. */
      isDeepLink: boolean;
      bookmarkGlobalOrdinal: number;
      progressPercent: number;
      totalParagraphs: number;
      chapterCount: number;
    }
  /** A highlight was persisted, whoever made it. */
  | {
      name: "highlight_created";
      workId: string;
      /** Derived display locator, e.g. `§4 ¶2–3` — never a stored string. */
      locator: string;
      role: "hand" | "rig";
      /** Characters covered, summed across every paragraph the highlight reaches. Never the text. */
      textLength: number;
      /** How many paragraphs it spans — 1 for the ordinary case. */
      paragraphCount: number;
      /** Where it starts. A spanning highlight can end in another section. */
      sectionOrdinal: number;
      chapterOrdinal: number;
      /** It reaches past the section it started in. */
      spansSections: boolean;
      /** Made together with a note, rather than on its own. */
      withNote: boolean;
    }
  /** An entry was written into the margin. */
  | {
      name: "note_created";
      workId: string;
      locator: string;
      origin: "hand" | "rig";
      /** It's a note *about* a highlight, not a bare paragraph note. */
      hasHighlightRef: boolean;
      hasExcerpt: boolean;
      /** Characters written. Never the words. */
      bodyLength: number;
      /** Characters of the excerpt it was saved against. Never the excerpt. */
      excerptLength: number;
      sectionOrdinal: number;
      chapterOrdinal: number;
    }
  /** The bookmark moved. High-volume by design — one per scroll settle that advances it. */
  | {
      name: "bookmark_updated";
      workId: string;
      globalOrdinal: number;
      progressPercent: number;
      totalParagraphs: number;
      sectionOrdinal: number;
      chapterOrdinal: number;
    }
  /**
   * A new RigSession was started for a work — the session picker's "start
   * a new conversation" action, and also whatever a work's very first Rig
   * open falls back to (`getOrCreateActiveRigSession`). Fired from
   * `rig-sessions.tsx`'s action, not `rig.tsx`: creating the row and
   * sending the first message are two separate requests in this UI, and
   * a session created but never sent into is still worth counting as a
   * start.
   */
  | {
      name: "rig_session_started";
      workId: string;
      /** Including this one — 1 means this work's very first Rig session. */
      sessionCount: number;
    }
  /**
   * The reader picked a *different* session in `RigSessionMenu` — an
   * explicit switch, not the panel's own first-open auto-select or the
   * reconnect `useRigLiveSession` does after every send (see that file:
   * picking a session is client-side state with no request of its own,
   * so the loader's GET can't stand in for "switched" without conflating
   * it with those). Reported as a beacon instead
   * (`app/routes/analytics-beacon.tsx`, `app/analyticsBeacon.ts`)
   * fired only from the menu's own `onSelect`, which is the one call site
   * that actually means "the reader chose this."
   */
  | {
      name: "rig_session_switched";
      workId: string;
      /** How many sessions this work has to switch among. */
      sessionCount: number;
    }
  /**
   * A message was sent into an existing RigSession. Fired from `rig.tsx`'s
   * action once the send itself succeeds — a message that fails to send
   * (e.g. the recovery retry in `withRigSessionRecovery` also throwing)
   * reports nothing, the same way a highlight that fails validation never
   * reaches `highlight_created`.
   *
   * Never the message itself (#78's rule applies here exactly as it does
   * to a highlight or a note) — a length, not the words.
   */
  | {
      name: "rig_message_sent";
      workId: string;
      messageLength: number;
      /** A `?session=<id>` named a specific RigSession, rather than
       * falling back to whichever one is active — same shape as
       * `work_opened`'s `isDeepLink`. */
      hasExplicitSession: boolean;
    }
  /**
   * The reader moved between sections via SectionNav's previous/next
   * buttons — `jumpToSection` in `read.tsx`, which is otherwise entirely
   * client-side (`history.replaceState`, deliberately not a navigation,
   * since the whole work's paragraphs are already loaded). Reported as a
   * beacon (`app/routes/analytics-beacon.tsx`) rather than left typed-but-
   * unemitted, same reasoning as `rig_session_switched`.
   *
   * One event per *burst*, not per click: `jumpToSection` debounces
   * (see `read.tsx`'s `NAV_BURST_DEBOUNCE_MS`) so clicking "next" three
   * times in quick succession reports one jump of `delta: 3`, not three
   * separate ones — a reader stepping quickly to a section a few ahead is
   * one navigation action, not several, the same instinct
   * `computeReadingProgress` already applies by re-deriving from settled
   * state rather than every intermediate scroll tick.
   */
  | {
      name: "section_navigated";
      workId: string;
      /** Net sections moved during the burst — positive forward, negative
       * backward. Three "next" clicks then one "previous" nets `2`. */
      delta: number;
      fromChapterOrdinal: number;
      fromSectionOrdinal: number;
      toChapterOrdinal: number;
      toSectionOrdinal: number;
    }
  /**
   * The Rig panel was opened — from the reader header's Rig button, or by
   * asking the Rig about a selected passage (`SelectionHighlighter`'s "Ask
   * the Rig"). Distinct from `rig_session_started`: most opens land on
   * whichever session is already active rather than creating a new one, so
   * this is the "reader summoned the Rig at all" signal, not a session
   * lifecycle one. Reported as a beacon (`app/routes/analytics-beacon.tsx`)
   * for the same reason as `rig_session_switched` — purely client-side
   * state (`setRigOpen` in `read.tsx`) with no request of its own to hang
   * off.
   */
  | {
      name: "rig_opened";
      workId: string;
      source: "header" | "selection";
      /** An on-screen excerpt or the selected passage was attached as
       * context for the first message — always `true` for `"selection"`,
       * only sometimes for `"header"` (see `formatOnScreenExcerpt`). */
      hasContext: boolean;
    }
  /** An EPUB was ingested. Fired from `scripts/ingest.ts` — a CLI, not a request. */
  | {
      name: "epub_ingested";
      workId: string;
      title: string;
      chapterCount: number;
      paragraphCount: number;
      durationMs: number;
      /** How many things `parseEpub` found structurally ambiguous. */
      warningCount: number;
      sourceBytes: number;
    };

export type AnalyticsEventName = AnalyticsEvent["name"];

/**
 * The names `app/routes/analytics-beacon.tsx` will relay on a browser's
 * behalf. Everything else in the catalog derives from data only a route
 * handler has — an ownership-checked paragraph, a validated form field —
 * and reports itself from there; this whitelist is what stops a modified
 * client from forging an event outside it (a fake `epub_ingested` with a
 * made-up `durationMs`, say). Add a name here only when the event is
 * genuinely client-only, the way picking a session in `RigSessionMenu` is.
 */
export type ClientAnalyticsEventName = "rig_session_switched" | "section_navigated" | "rig_opened";

export type ClientAnalyticsEvent = Extract<AnalyticsEvent, { name: ClientAnalyticsEventName }>;

export type TrackContext = {
  /**
   * PostHog's `distinct_id`. Always `requireUser()`'s `user.id` — a single
   * stable, non-anonymous id (`local-user`, from `prisma/seed.ts`), so
   * there is no anonymous-id/identify-merge problem to solve here. When
   * real auth arrives this stays exactly what it is: whoever
   * `requireUser()` says you are.
   */
  distinctId: string;
};

/** PostHog Cloud US. Overridden by `POSTHOG_HOST` for EU or self-hosted. */
const DEFAULT_HOST = "https://us.i.posthog.com";

/**
 * Analytics is on only when a project key exists. No key — local dev,
 * `npm test`, CI, or simply not wanting to be measured today — and
 * `track()` is a no-op: the SDK is never even imported, no client is
 * constructed, and nothing throws. Same shape as `chromatic.yml`'s
 * `if: ${{ env.CHROMATIC_PROJECT_TOKEN != '' }}` skip, moved to runtime
 * because this isn't a CI step.
 *
 * Read per call rather than captured at module load so the environment is
 * always the current one (and so a test can set and unset it).
 */
export function analyticsEnabled(): boolean {
  return Boolean(process.env.POSTHOG_PROJECT_API_KEY);
}

// Vite's dev server re-evaluates this module on every HMR reload, and a
// PostHog client owns a periodic flush timer — without caching, each
// reload would leak another one. Same globalThis trick, and the same
// reason, as db.server.ts's Prisma client.
const globalForAnalytics = globalThis as unknown as { analytics?: Promise<PostHog> };

/**
 * The client, constructed at most once and only if there's a key.
 *
 * The `import()` is dynamic on purpose: with no key set, `posthog-node`
 * is never loaded at all, so "no-op" means no SDK in the module graph, no
 * queue, no flush timer — not merely a capture call that gets dropped.
 */
async function getClient(): Promise<PostHog | null> {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY;
  if (!apiKey) return null;

  globalForAnalytics.analytics ??= import("posthog-node").then(
    ({ PostHog }) =>
      new PostHog(apiKey, {
        host: process.env.POSTHOG_HOST || DEFAULT_HOST,
        // Explicitly off, not merely unset: the one thing posthog-node
        // will capture without a call site in this file. See the header.
        enableExceptionAutocapture: false,
        // One reader, one machine. An IP-derived location on every event
        // is noise at best.
        disableGeoip: true,
      }),
  );

  return globalForAnalytics.analytics;
}

/**
 * Report that something happened.
 *
 * Never throws and never rejects: analytics failing is not a reason for a
 * highlight to fail to save. Awaiting it is cheap — `capture()` only
 * enqueues, it doesn't wait on the network — so call sites can `await`
 * without slowing a response down.
 */
export async function track(event: AnalyticsEvent, { distinctId }: TrackContext): Promise<void> {
  try {
    const client = await getClient();
    if (!client) return;

    const { name, ...properties } = event;
    client.capture({ distinctId, event: name, properties });
  } catch (error) {
    // Deliberately swallowed, but not silently: a misconfigured host
    // should be visible in the server log, not in the reader's way.
    console.warn(`[analytics] could not report ${event.name}:`, error);
  }
}

/**
 * Flush and close the client.
 *
 * Only something with no request lifecycle to hang off needs this — a CLI
 * like `scripts/ingest.ts`, which would otherwise exit with its one event
 * still sitting in the queue. A long-running server never calls it; the
 * client's own periodic flush handles that case.
 *
 * A no-op when nothing was ever constructed, so a script can call it
 * unconditionally in a `finally`.
 */
export async function shutdownAnalytics(): Promise<void> {
  const pending = globalForAnalytics.analytics;
  globalForAnalytics.analytics = undefined;
  if (!pending) return;
  try {
    await (await pending).shutdown();
  } catch (error) {
    console.warn("[analytics] could not flush before shutdown:", error);
  }
}
