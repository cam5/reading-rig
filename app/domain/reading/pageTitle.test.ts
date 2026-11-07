import { describe, expect, it } from "vitest";
import { readPageTitle } from "./pageTitle";

describe("readPageTitle", () => {
  // Pinned exactly: the Rig session routes report this string to analytics
  // as the page title, so a change here is a change to reported data.
  it("renders the reading view's tab title with an em dash", () => {
    expect(readPageTitle("Middlemarch")).toBe("Middlemarch — Reading Rig");
  });
});
