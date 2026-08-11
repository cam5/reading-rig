import { describe, expect, it } from "vitest";
import { highlightClassName } from "./highlightRole";

describe("highlightClassName", () => {
  it("colours a hand highlight #FFCC00/30% — a literal, not a token (#135)", () => {
    expect(highlightClassName("hand")).toBe("bg-[rgba(255,204,0,0.3)]");
  });

  it("colours a rig highlight terracotta — the machine's voice", () => {
    expect(highlightClassName("rig")).toBe("bg-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]");
  });
});
