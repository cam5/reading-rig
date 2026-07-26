import { describe, expect, it } from "vitest";
import { framePostureTurn, nextPostureIndex, POSTURE_ORDER } from "./postures";

describe("nextPostureIndex", () => {
  it("moves forward on ArrowDown and ArrowRight", () => {
    expect(nextPostureIndex(0, "ArrowDown", 6)).toBe(1);
    expect(nextPostureIndex(0, "ArrowRight", 6)).toBe(1);
  });

  it("moves backward on ArrowUp and ArrowLeft", () => {
    expect(nextPostureIndex(2, "ArrowUp", 6)).toBe(1);
    expect(nextPostureIndex(2, "ArrowLeft", 6)).toBe(1);
  });

  it("wraps from the last posture forward to the first", () => {
    expect(nextPostureIndex(5, "ArrowDown", 6)).toBe(0);
  });

  it("wraps from the first posture backward to the last", () => {
    expect(nextPostureIndex(0, "ArrowUp", 6)).toBe(5);
  });

  it("jumps to the first/last posture on Home/End", () => {
    expect(nextPostureIndex(3, "Home", 6)).toBe(0);
    expect(nextPostureIndex(3, "End", 6)).toBe(5);
  });

  it("returns null for a key it doesn't answer to, so the caller leaves the event alone", () => {
    expect(nextPostureIndex(0, "Tab", 6)).toBeNull();
    expect(nextPostureIndex(0, "a", 6)).toBeNull();
    expect(nextPostureIndex(0, "Enter", 6)).toBeNull();
  });

  it("covers all six real postures without going out of range", () => {
    let index = 0;
    for (let i = 0; i < POSTURE_ORDER.length; i++) {
      index = nextPostureIndex(index, "ArrowDown", POSTURE_ORDER.length) ?? index;
    }
    // A full lap of all six ArrowDowns returns to the start.
    expect(index).toBe(0);
  });
});

describe("framePostureTurn", () => {
  it("states the posture at the start of the turn, per the system prompt's own framing", () => {
    expect(framePostureTurn("Interrogate", "Where does the argument turn?")).toBe(
      "Posture: Interrogate\n\nWhere does the argument turn?",
    );
  });

  it("doesn't mangle a question that itself contains newlines", () => {
    expect(framePostureTurn("Connect", "First line.\nSecond line.")).toBe(
      "Posture: Connect\n\nFirst line.\nSecond line.",
    );
  });
});
