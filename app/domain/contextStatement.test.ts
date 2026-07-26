import { describe, expect, it } from "vitest";
import { contextStatement, type ContextSet } from "./contextStatement";

describe("contextStatement", () => {
  it("states the passage alone, plus the bookmark exclusion, when nothing has been added", () => {
    const set: ContextSet = { passageLabel: "§4 ¶1–4", items: [] };
    expect(contextStatement(set)).toBe("In view: this passage (§4 ¶1–4). Nothing past your bookmark.");
  });

  it("joins the passage and one added item with 'and'", () => {
    const set: ContextSet = {
      passageLabel: "§4 ¶3",
      items: [{ id: "e1", label: "your note, 12 Mar" }],
    };
    expect(contextStatement(set)).toBe(
      "In view: this passage (§4 ¶3) and your note, 12 Mar. Nothing past your bookmark.",
    );
  });

  it("uses an Oxford comma across three or more items", () => {
    const set: ContextSet = {
      passageLabel: "§4",
      items: [
        { id: "e1", label: "your note, 12 Mar" },
        { id: "e2", label: "your Interrogate entry, 10 Mar" },
      ],
    };
    expect(contextStatement(set)).toBe(
      "In view: this passage (§4), your note, 12 Mar, and your Interrogate entry, 10 Mar. Nothing past your bookmark.",
    );
  });

  it("always ends with the exclusion clause, stated plainly, never as a token count", () => {
    const set: ContextSet = { passageLabel: "§1 ¶1", items: [] };
    const statement = contextStatement(set);
    expect(statement).toMatch(/Nothing past your bookmark\.$/);
    expect(statement).not.toMatch(/tokens?/i);
  });

  it("never exclaims, and carries no emoji", () => {
    const set: ContextSet = {
      passageLabel: "§4",
      items: [{ id: "e1", label: "your note, 12 Mar" }],
    };
    const statement = contextStatement(set);
    expect(statement).not.toContain("!");
    // No characters outside the Basic Multilingual Plane — emoji live
    // above it (surrogate pairs), quiet literary prose doesn't.
    expect(Array.from(statement).every((char) => char.codePointAt(0)! <= 0xffff)).toBe(true);
  });
});
