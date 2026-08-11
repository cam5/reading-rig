import { describe, expect, it } from "vitest";
import { parseTranscriptSegments } from "./transcriptMarkers";

describe("parseTranscriptSegments", () => {
  it("returns a single text segment when there are no markers", () => {
    expect(parseTranscriptSegments("What does this mean?")).toEqual([{ type: "text", value: "What does this mean?" }]);
  });

  it("splits a context tag, a pill tag, and surrounding text", () => {
    const text =
      `⟦context⟧Reading "Capital" by Karl Marx. Currently on screen:\n\nA commodity...⟦/context⟧\n\n` +
      `What does ⟦pill kind="paragraph" locator="§4 ¶3"⟧A commodity appears...⟦/pill⟧ mean?`;

    expect(parseTranscriptSegments(text)).toEqual([
      { type: "context", text: 'Reading "Capital" by Karl Marx. Currently on screen:\n\nA commodity...' },
      { type: "text", value: "\n\nWhat does " },
      { type: "pill", kind: "paragraph", locator: "§4 ¶3", text: "A commodity appears..." },
      { type: "text", value: " mean?" },
    ]);
  });

  it("parses a pill body containing a literal double quote", () => {
    const text = `⟦pill kind="note" locator="§2 ¶1"⟧Is "value" the right word here?⟦/pill⟧`;
    expect(parseTranscriptSegments(text)).toEqual([
      { type: "pill", kind: "note", locator: "§2 ¶1", text: 'Is "value" the right word here?' },
    ]);
  });

  it("leaves the old, pre-marker formats as plain text", () => {
    const oldPill = `What does "A commodity appears…" (§4 ¶3) mean?`;
    expect(parseTranscriptSegments(oldPill)).toEqual([{ type: "text", value: oldPill }]);

    const oldContext = `[Reading "Capital" by Karl Marx. Currently on screen:\n\nA commodity...]`;
    expect(parseTranscriptSegments(oldContext)).toEqual([{ type: "text", value: oldContext }]);
  });

  it("parses multiple pills in one message", () => {
    const text =
      `⟦pill kind="paragraph" locator="§1 ¶1"⟧First.⟦/pill⟧ and ` +
      `⟦pill kind="onScreen" locator="§2 ¶1"⟧Second.⟦/pill⟧`;

    expect(parseTranscriptSegments(text)).toEqual([
      { type: "pill", kind: "paragraph", locator: "§1 ¶1", text: "First." },
      { type: "text", value: " and " },
      { type: "pill", kind: "onScreen", locator: "§2 ¶1", text: "Second." },
    ]);
  });
});
