import { describe, expect, it } from "vitest";
import { EpubParseError } from "./parseEpub";
import { epubParseErrorMessage } from "./parseErrorMessage";

describe("epubParseErrorMessage — upload.tsx's reader copy per parse failure", () => {
  it.each(["not-a-zip", "missing-container", "missing-package"] as const)(
    "tells the reader a %s file isn't a valid EPUB, and what to try",
    (reason) => {
      const message = epubParseErrorMessage(new EpubParseError(reason, "x"));
      expect(message).toContain("isn't a valid EPUB");
      expect(message).toContain("Try re-downloading it.");
    },
  );

  it("says a decompression-cap rejection is about size, not validity", () => {
    const message = epubParseErrorMessage(new EpubParseError("too-large", "x"));
    expect(message).toBe(
      "That EPUB is too large once unpacked. Try a different edition.",
    );
  });

  it("falls back to generic copy for a throw parseEpub didn't name", () => {
    const message = epubParseErrorMessage(new TypeError("x is undefined"));
    expect(message).toContain("couldn't be read");
    // The raw error text is developer detail, never reader copy.
    expect(message).not.toContain("undefined");
  });
});
