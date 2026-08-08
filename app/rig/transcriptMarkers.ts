import type { PillCandidate } from "~/components/tokenPill";

export type TranscriptSegment =
  | { type: "text"; value: string }
  | { type: "pill"; kind: PillCandidate["kind"]; locator: string; text: string }
  | { type: "context"; text: string };

const PILL_PATTERN = /⟦pill kind="([^"]*)" locator="([^"]*)"⟧([\s\S]*?)⟦\/pill⟧/g;
const CONTEXT_PATTERN = /⟦context⟧([\s\S]*?)⟦\/context⟧/g;

type Match = { start: number; end: number; segment: TranscriptSegment };

function collectMatches(text: string, pattern: RegExp, toSegment: (match: RegExpExecArray) => TranscriptSegment): Match[] {
  const matches: Match[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    matches.push({ start: match.index, end: match.index + match[0].length, segment: toSegment(match) });
  }
  return matches;
}

/**
 * Parses a message's raw text (as sent to, or received back from, the Rig)
 * into an ordered list of plain-text runs and collapsible pills — the
 * display-side counterpart to tokenPill.ts's `serializeComposer` and
 * buildLaunchContext.ts's `buildRigLaunchContext`, which are what actually
 * write the `⟦pill⟧`/`⟦context⟧` tags into the text that gets sent.
 *
 * Text that predates this format (the old `"text" (locator)` shape, or a
 * bare `[Reading...]` header, or anything a reader just typed) simply
 * doesn't match either pattern and comes back as a single text segment —
 * graceful degradation, not a special case this function has to know about.
 */
export function parseTranscriptSegments(text: string): TranscriptSegment[] {
  const matches = [
    ...collectMatches(text, PILL_PATTERN, (match) => ({
      type: "pill",
      kind: match[1] as PillCandidate["kind"],
      locator: match[2],
      text: match[3],
    })),
    ...collectMatches(text, CONTEXT_PATTERN, (match) => ({ type: "context", text: match[1] })),
  ].sort((a, b) => a.start - b.start);

  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    // The two tag shapes can't legitimately nest or overlap; if a pill's or
    // context's quoted text ever happened to contain the other tag's start
    // (the known escaping limitation both serializers accept), keep the
    // earlier match and let the later one fall back to plain text rather
    // than producing a garbled split.
    if (match.start < cursor) continue;
    if (match.start > cursor) segments.push({ type: "text", value: text.slice(cursor, match.start) });
    segments.push(match.segment);
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) });
  return segments;
}
