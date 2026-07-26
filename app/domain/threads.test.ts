import { describe, expect, it } from "vitest";
import { nextThreadOrdinal } from "./threads";

describe("nextThreadOrdinal", () => {
  it("starts a new thread's first entry at 0", () => {
    expect(nextThreadOrdinal([])).toBe(0);
  });

  it("appends after the highest existing ordinal, even with gaps", () => {
    expect(nextThreadOrdinal([0, 2, 5])).toBe(6);
  });

  it("doesn't assume ordinals arrive sorted", () => {
    expect(nextThreadOrdinal([4, 0, 2])).toBe(5);
  });

  it("continues from a single existing entry", () => {
    expect(nextThreadOrdinal([0])).toBe(1);
  });
});
