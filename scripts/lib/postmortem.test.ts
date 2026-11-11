import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HUMAN_ONLY_HEADINGS,
  POSTMORTEM_HEADINGS,
  type PostmortemFacts,
  buildTimeline,
  classifyIncident,
  extractLinkedRefs,
  incidentDate,
  renderPostmortem,
  slugify,
} from "./postmortem";

describe("slugify", () => {
  it("lowercases, hyphenates and drops PR refs", () => {
    expect(
      slugify(
        "Fix magic-link migration crashing prod: backfill legacy User.email (#188)",
      ),
    ).toBe("fix-magic-link-migration-crashing-prod-backfill-legacy-user");
  });

  it("strips diacritics and caps the length without a trailing hyphen", () => {
    expect(slugify("Café — résumé")).toBe("cafe-resume");
    const long = slugify("a ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("-")).toBe(false);
  });

  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("incident");
  });
});

describe("classifyIncident", () => {
  it("classifies #188 as a release/migration failure despite 'crashing prod'", () => {
    expect(
      classifyIncident(
        "Fix magic-link migration to backfill legacy User.email instead of crashing prod",
      ).category,
    ).toBe("release-migration");
  });

  it("classifies a build failure", () => {
    expect(
      classifyIncident("Build failed: Nixpacks can't find the lockfile")
        .category,
    ).toBe("build");
  });

  it("classifies a runtime/config failure", () => {
    expect(
      classifyIncident(
        "Server crash-loops on boot: missing env var RESEND_API_KEY",
      ).category,
    ).toBe("runtime-config");
  });

  it("classifies a client (iOS) failure", () => {
    expect(
      classifyIncident(
        'Rename the Fonts resource folder off "Resources" — fixes a real Xcode codesign failure',
      ).category,
    ).toBe("client-ios");
  });

  it("falls back to unknown", () => {
    const result = classifyIncident("Tidy up the commonplace book copy");
    expect(result.category).toBe("unknown");
    expect(result.label).toMatch(/unknown/i);
  });

  it("counts changed file paths as evidence", () => {
    expect(
      classifyIncident(
        "Small fix\nprisma/migrations/20260811013131_add_magic_link_auth/migration.sql",
      ).category,
    ).toBe("release-migration");
  });
});

describe("buildTimeline", () => {
  it("sorts ascending in UTC and dedupes by ref", () => {
    const rows = buildTimeline([
      {
        at: "2026-08-17T21:56:54Z",
        kind: "pr-merged",
        label: "merged",
        ref: "pr-188-merged",
      },
      { at: "2026-08-17T21:39:03Z", kind: "commit", label: "fix", ref: "abc" },
      // Same commit seen again via git rather than gh.
      {
        at: "2026-08-17T17:39:03-04:00",
        kind: "commit",
        label: "fix (git)",
        ref: "abc",
      },
      { at: "2026-08-17T21:39:23Z", kind: "pr-opened", label: "opened" },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["fix", "opened", "merged"]);
    expect(rows[0].at).toBe("2026-08-17 21:39");
  });

  it("dedupes ref-less events by time, kind and label, and drops bad dates", () => {
    const rows = buildTimeline([
      { at: new Date("2026-01-01T00:00:00Z"), kind: "deploy", label: "x" },
      { at: "2026-01-01T00:00:00.000Z", kind: "deploy", label: "x" },
      { at: "2026-01-01T00:00:00Z", kind: "deploy", label: "y" },
      { at: "not a date", kind: "deploy", label: "z" },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["x", "y"]);
  });
});

describe("extractLinkedRefs", () => {
  it("finds refs and closing keywords, ignoring URLs and hex colours", () => {
    const refs = extractLinkedRefs(
      "Fixes #113. Follows #186/#187 — see https://github.com/x/y/pull/12#issuecomment-9 " +
        "and colour #FFCC00 / #123456. closes: #145, Resolves #7",
    );
    expect(refs.refs).toEqual([7, 113, 145, 186, 187]);
    expect(refs.closes).toEqual([7, 113, 145]);
  });
});

const FACTS_188: PostmortemFacts = {
  source: { kind: "pr", number: 188 },
  title: "Fix magic-link migration crashing prod: backfill legacy User.email",
  generatedAt: "2026-11-11T00:00:00Z",
  pullRequests: [
    {
      number: 188,
      title:
        "Fix magic-link migration crashing prod: backfill legacy User.email",
      body: "Production went down right after PR #186/#187 merged.",
      createdAt: "2026-08-17T21:39:23Z",
      mergedAt: "2026-08-17T21:56:54Z",
      files: [
        "prisma/migrations/20260811013131_add_magic_link_auth/migration.sql",
      ],
      closingIssues: [],
    },
  ],
  commits: [
    {
      sha: "8bbfed2000000000000000000000000000000000",
      subject:
        "Fix magic-link migration to backfill legacy User.email instead of crashing prod (#188)",
      date: "2026-08-17T21:56:54Z",
      files: [
        "prisma/migrations/20260811013131_add_magic_link_auth/migration.sql",
      ],
    },
  ],
};

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = markdown.slice(start + heading.length + 5);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("renderPostmortem", () => {
  const markdown = renderPostmortem(FACTS_188);

  it("has every template heading, in order", () => {
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([...POSTMORTEM_HEADINGS]);
  });

  it("matches TEMPLATE.md's headings", () => {
    const template = fs.readFileSync(
      new URL("../../docs/postmortems/TEMPLATE.md", import.meta.url),
      "utf8",
    );
    const headings = [...template.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([...POSTMORTEM_HEADINGS]);
  });

  it("leaves a TODO in every human-only section", () => {
    for (const heading of HUMAN_ONLY_HEADINGS) {
      expect(section(markdown, heading)).toContain("<!-- TODO:");
    }
  });

  it("pre-fills facts: category, timeline, trigger candidates and refs", () => {
    expect(markdown).toContain(
      "**Suggested category:** Release/migration failure",
    );
    expect(section(markdown, "Timeline (UTC)")).toContain(
      "| 2026-08-17 21:39 | PR #188 opened",
    );
    expect(section(markdown, "Trigger")).toContain(
      "`prisma/migrations/20260811013131_add_magic_link_auth/migration.sql`",
    );
    expect(section(markdown, "Related PRs, commits and issues")).toContain(
      "Also mentioned: #186, #187",
    );
    expect(incidentDate(FACTS_188)).toBe("2026-08-17");
  });

  it("flags a git-only draft", () => {
    expect(
      renderPostmortem({ ...FACTS_188, pullRequests: [], gitOnly: true }),
    ).toContain("Only git was consulted");
  });
});
