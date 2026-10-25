import { describe, expect, it, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  formatRateLimitWindow,
  getClientIp,
} from "./rateLimit.server";

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows up to the limit within the window", () => {
    const key = `k-${Math.random()}`;
    expect(checkRateLimit(key, 3, 1000)).toBe(true);
    expect(checkRateLimit(key, 3, 1000)).toBe(true);
    expect(checkRateLimit(key, 3, 1000)).toBe(true);
  });

  it("rejects once the limit is exceeded within the window", () => {
    const key = `k-${Math.random()}`;
    checkRateLimit(key, 2, 1000);
    checkRateLimit(key, 2, 1000);
    expect(checkRateLimit(key, 2, 1000)).toBe(false);
  });

  it("tracks each key independently", () => {
    const keyA = `k-${Math.random()}`;
    const keyB = `k-${Math.random()}`;
    checkRateLimit(keyA, 1, 1000);
    expect(checkRateLimit(keyA, 1, 1000)).toBe(false);
    expect(checkRateLimit(keyB, 1, 1000)).toBe(true);
  });

  it("resets once the window elapses", () => {
    const key = `k-${Math.random()}`;
    const now = vi.spyOn(Date, "now");

    now.mockReturnValue(0);
    checkRateLimit(key, 1, 1000);
    expect(checkRateLimit(key, 1, 1000)).toBe(false);

    now.mockReturnValue(1001);
    expect(checkRateLimit(key, 1, 1000)).toBe(true);
  });
});

describe("getClientIp", () => {
  it("reads the left-most entry of X-Forwarded-For", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to a fixed key when the header is absent", () => {
    const request = new Request("https://example.com");
    expect(getClientIp(request)).toBe("unknown");
  });
});

describe("formatRateLimitWindow", () => {
  it("renders the login and upload windows as their copy reads", () => {
    expect(formatRateLimitWindow(15 * 60 * 1000)).toBe("15 minutes");
    expect(formatRateLimitWindow(60 * 60 * 1000)).toBe("an hour");
  });

  it("follows the constant when it changes", () => {
    expect(formatRateLimitWindow(60 * 1000)).toBe("a minute");
    expect(formatRateLimitWindow(90 * 60 * 1000)).toBe("90 minutes");
    expect(formatRateLimitWindow(2 * 60 * 60 * 1000)).toBe("2 hours");
  });
});
