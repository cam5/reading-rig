import { describe, expect, it } from "vitest";
import { highlightClassName } from "./highlightRole";

describe("highlightClassName", () => {
  it("colours a hand highlight sage — your hand and your shelf", () => {
    expect(highlightClassName("hand")).toBe("bg-[color-mix(in_srgb,var(--color-accent-2)_35%,transparent)]");
  });

  it("colours a rig highlight terracotta — the machine's voice", () => {
    expect(highlightClassName("rig")).toBe("bg-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]");
  });
});
