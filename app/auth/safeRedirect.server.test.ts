import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safeRedirect.server";

describe("safeRedirect", () => {
  it.each(["/", "/read?work=x#p3", "/read/abc"])("keeps %s", (to) => {
    expect(safeRedirect(to)).toBe(to);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    "read",
    "",
  ])("rejects %j", (to) => {
    expect(safeRedirect(to)).toBe("/");
  });

  it("rejects non-string values", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect(new File([], "x"))).toBe("/");
  });

  it("keeps a percent-encoded tab, which is just a literal path segment", () => {
    // `%09` stays encoded through URL parsing — it's never turned back into
    // a real tab, so it can't collapse `/%09/` into `//`.
    expect(safeRedirect("/%09/evil.example")).toBe("/%09/evil.example");
  });

  it("returns the caller's fallback when given one", () => {
    expect(safeRedirect("https://evil.example", "")).toBe("");
  });
});
