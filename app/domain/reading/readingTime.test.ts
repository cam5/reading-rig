import { describe, expect, it } from "vitest";
import {
  countWords,
  estimateMinutesRemaining,
  formatTimeRemaining,
} from "./readingTime";

describe("countWords", () => {
  it("counts words separated by whitespace", () => {
    expect(countWords("The form of wood is altered.")).toBe(6);
  });

  it("treats an empty or whitespace-only string as zero words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("collapses runs of whitespace rather than counting empty tokens", () => {
    expect(countWords("one   two")).toBe(2);
  });
});

describe("estimateMinutesRemaining", () => {
  it("rounds up — a partial minute still counts as a minute", () => {
    expect(estimateMinutesRemaining(1)).toBe(1);
    expect(estimateMinutesRemaining(200)).toBe(1);
    expect(estimateMinutesRemaining(201)).toBe(2);
  });

  it("returns zero for no remaining words", () => {
    expect(estimateMinutesRemaining(0)).toBe(0);
  });
});

describe("formatTimeRemaining", () => {
  it("formats under a minute distinctly from zero minutes rounding oddly", () => {
    expect(formatTimeRemaining(0)).toBe("less than a minute left");
  });

  it("formats minutes under an hour", () => {
    expect(formatTimeRemaining(45)).toBe("45 min left");
  });

  it("formats whole hours without a dangling '0m'", () => {
    expect(formatTimeRemaining(120)).toBe("2h left");
  });

  it("formats hours and minutes together", () => {
    expect(formatTimeRemaining(125)).toBe("2h 5m left");
  });
});
