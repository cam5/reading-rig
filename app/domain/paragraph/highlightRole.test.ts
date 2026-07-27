import { describe, expect, it } from "vitest";
import { highlightClassName } from "./highlightRole";

describe("highlightClassName", () => {
  it("colours a hand highlight sage — your hand and your shelf", () => {
    expect(highlightClassName("hand")).toBe("bg-accent-2-200");
  });

  it("colours a rig highlight terracotta — the machine's voice", () => {
    expect(highlightClassName("rig")).toBe("bg-accent-200");
  });
});
