import { describe, expect, it } from "vitest";
import {
  buildGraph,
  classifyLayer,
  extractImports,
  findViolations,
  mermaidId,
  renderMarkdown,
  resolveSpecifier,
  selectSourcePaths,
  type SourceFile,
} from "./topology";

describe("classifyLayer", () => {
  it.each([
    ["app/domain/locator.ts", "app/domain"],
    ["app/domain/api/openapi.server.ts", "app/domain"],
    ["app/rig/sessionLoop.ts", "app/rig"],
    ["app/rig/tools/searchText.ts", "app/rig/tools"],
    ["app/components/Margin.tsx", "app/components"],
    ["app/routes/read.tsx", "app/routes"],
    ["app/routes/+types/read", "app/routes"],
    ["app/auth/session.server.ts", "app/auth"],
    ["app/styles/organic.css", "app/styles"],
    ["app/root.tsx", "app (root)"],
    ["app/+types/root", "app (root)"],
    ["app/user.server.ts", "app (root)"],
    ["lib/paged-columns/index.ts", "lib"],
    ["scripts/ingest.ts", "scripts"],
    ["prisma/seed.ts", "prisma"],
    ["generated/prisma/client", "generated"],
    ["ios/Sources/App.swift", "ios"],
    ["design/support.js", "design"],
    [".storybook/preview.tsx", ".storybook"],
    ["vite.config.ts", "other"],
  ])("%s → %s", (path, layer) => {
    expect(classifyLayer(path)).toBe(layer);
  });
});

describe("extractImports", () => {
  it("finds static, side-effect, re-export and dynamic imports", () => {
    const src = [
      `import React, { useState } from "react";`,
      `import "./app.css";`,
      `export { a, b } from './a';`,
      `export * from "./b";`,
      `export * as c from "./c";`,
      `const m = await import("./lazy");`,
    ].join("\n");
    expect(extractImports(src)).toEqual([
      { specifier: "react", kind: "static", typeOnly: false },
      { specifier: "./app.css", kind: "side-effect", typeOnly: false },
      { specifier: "./a", kind: "reexport", typeOnly: false },
      { specifier: "./b", kind: "reexport", typeOnly: false },
      { specifier: "./c", kind: "reexport", typeOnly: false },
      { specifier: "./lazy", kind: "dynamic", typeOnly: false },
    ]);
  });

  it("marks `import type` and `export type` as type-only", () => {
    const src = [
      `import type { Route } from "./+types/read";`,
      `export type { Locator } from "~/domain/locator";`,
      `import { type A, B } from "./mixed";`,
    ].join("\n");
    expect(extractImports(src)).toEqual([
      { specifier: "./+types/read", kind: "static", typeOnly: true },
      { specifier: "~/domain/locator", kind: "reexport", typeOnly: true },
      { specifier: "./mixed", kind: "static", typeOnly: false },
    ]);
  });

  it("handles multiline import lists", () => {
    const src = `import {\n  a,\n  b,\n  type C,\n} from "../x";\n`;
    expect(extractImports(src).map((i) => i.specifier)).toEqual(["../x"]);
  });

  it("ignores imports inside comments, strings and templates", () => {
    const src = [
      `// import x from "commented";`,
      `/* import y from "blocked"; */`,
      `const s = "import z from 'in-a-string'";`,
      'const t = `import w from "in-a-template"`;',
      `const label = "loaded from history";`,
      `import real from "real";`,
    ].join("\n");
    expect(extractImports(src).map((i) => i.specifier)).toEqual(["real"]);
  });

  it("doesn't let a regex literal with quotes desync the scanner", () => {
    const src = [
      `const q = /['"]/g;`,
      `const n = a / b / c;`,
      `import after from "after";`,
    ].join("\n");
    expect(extractImports(src).map((i) => i.specifier)).toEqual(["after"]);
  });

  it("ignores property access named import", () => {
    expect(extractImports(`foo.import("x");`)).toEqual([]);
  });

  it("doesn't read a JSX closing tag as a regex start", () => {
    const src = `const el = <p>it</p>; const L = lazy(() => import("./X"));`;
    expect(extractImports(src)).toEqual([
      { specifier: "./X", kind: "dynamic", typeOnly: false },
    ]);
  });

  it("doesn't read a self-closing JSX tag as a regex start", () => {
    const src = `const el = <A {...p} />; const L = lazy(() => import("./Y"));`;
    expect(extractImports(src).map((i) => i.specifier)).toEqual(["./Y"]);
  });

  it("finds require() specifiers", () => {
    const src = [
      `const config = require("../lighthouserc.cjs");`,
      `const fs = require ( 'node:fs' );`,
      `const p = require.resolve("not-a-require");`,
      `obj.require("not-either");`,
      `const s = "require('in-a-string')";`,
    ].join("\n");
    expect(extractImports(src)).toEqual([
      { specifier: "../lighthouserc.cjs", kind: "require", typeOnly: false },
      { specifier: "node:fs", kind: "require", typeOnly: false },
    ]);
  });
});

describe("selectSourcePaths", () => {
  it("drops files deleted from disk and keeps untracked ones", () => {
    expect(
      selectSourcePaths(
        ["app/a.ts", "app/gone.ts", "scripts/b.ts", "", "app/new.ts"],
        ["app/gone.ts", ""],
      ),
    ).toEqual(["app/a.ts", "app/new.ts", "scripts/b.ts"]);
  });

  it("dedupes paths listed more than once", () => {
    expect(selectSourcePaths(["b.ts", "a.ts", "b.ts"], [])).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});

describe("resolveSpecifier", () => {
  it("resolves relative paths against the importing file", () => {
    expect(
      resolveSpecifier("app/routes/read.tsx", "../domain/locator"),
    ).toEqual({ kind: "internal", path: "app/domain/locator" });
    expect(resolveSpecifier("app/rig/tools/a.ts", "./b")).toEqual({
      kind: "internal",
      path: "app/rig/tools/b",
    });
    expect(
      resolveSpecifier("app/domain/x.ts", "../../generated/prisma/client"),
    ).toEqual({ kind: "internal", path: "generated/prisma/client" });
  });

  it("maps the ~/ alias to app/", () => {
    expect(resolveSpecifier("app/routes/read.tsx", "~/domain/locator")).toEqual(
      { kind: "internal", path: "app/domain/locator" },
    );
  });

  it("reduces bare specifiers to their package name", () => {
    expect(resolveSpecifier("a.ts", "react")).toEqual({
      kind: "external",
      pkg: "react",
    });
    expect(resolveSpecifier("a.ts", "react-dom/server")).toEqual({
      kind: "external",
      pkg: "react-dom",
    });
    expect(resolveSpecifier("a.ts", "@anthropic-ai/sdk/resources")).toEqual({
      kind: "external",
      pkg: "@anthropic-ai/sdk",
    });
    expect(
      resolveSpecifier("a.ts", "@fontsource/figtree/files/x.woff2?url"),
    ).toEqual({ kind: "external", pkg: "@fontsource/figtree" });
  });
});

describe("buildGraph", () => {
  it("weights layer edges by import count and skips intra-layer imports", () => {
    const graph = buildGraph([
      {
        path: "app/routes/read.tsx",
        source: [
          `import { a } from "~/domain/a";`,
          `import type { B } from "../domain/b";`,
          `import { C } from "~/components/C";`,
          `import { r } from "./other";`,
          `import { useLoaderData } from "react-router";`,
        ].join("\n"),
      },
      { path: "app/domain/a.ts", source: `import { b } from "./b";` },
      { path: "app/domain/b.ts", source: "" },
      { path: "ios/Sources/App.swift" },
    ]);

    expect(graph.edges).toEqual([
      { from: "app/routes", to: "app/components", count: 1, typeOnly: 0 },
      { from: "app/routes", to: "app/domain", count: 2, typeOnly: 1 },
    ]);
    expect(graph.layers).toEqual(
      expect.arrayContaining([
        { layer: "app/domain", files: 2, parsed: 2 },
        { layer: "ios", files: 1, parsed: 0 },
      ]),
    );
    expect(graph.externals).toEqual([
      { layer: "app/routes", packages: [{ pkg: "react-router", count: 1 }] },
    ]);
  });
});

describe("findViolations", () => {
  it("flags React, React Router and the SDK in app/domain, type-only included", () => {
    const graph = buildGraph([
      { path: "app/domain/a.ts", source: `import { useState } from "react";` },
      {
        path: "app/domain/b.ts",
        source: `import type Anthropic from "@anthropic-ai/sdk";`,
      },
      {
        path: "app/domain/c.ts",
        source: `import { Margin } from "~/components/Margin";`,
      },
      { path: "app/domain/d.ts", source: `import { z } from "zod";` },
    ]);
    expect(findViolations(graph)).toEqual([
      {
        file: "app/domain/a.ts",
        specifier: "react",
        typeOnly: false,
        reason: "app/domain must not import react",
      },
      {
        file: "app/domain/b.ts",
        specifier: "@anthropic-ai/sdk",
        typeOnly: true,
        reason: "app/domain must not import @anthropic-ai/sdk",
      },
      {
        file: "app/domain/c.ts",
        specifier: "~/components/Margin",
        typeOnly: false,
        reason: "app/domain must not import from app/components",
      },
    ]);
  });

  it("allows the SDK in app/rig", () => {
    const graph = buildGraph([
      {
        path: "app/rig/agentConfig.ts",
        source: `import Anthropic from "@anthropic-ai/sdk";`,
      },
    ]);
    expect(findViolations(graph)).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  const files: SourceFile[] = [
    { path: "app/routes/read.tsx", source: `import { a } from "~/domain/a";` },
    { path: "app/domain/a.ts", source: `import { z } from "zod";` },
    { path: "app/domain/bad.ts", source: `import { useState } from "react";` },
    {
      path: "scripts/ingest.ts",
      source: `import { a } from "../app/domain/a";`,
    },
    { path: ".storybook/main.ts", source: `import "../app/app.css";` },
    { path: "ios/Sources/App.swift" },
  ];

  const render = (input: SourceFile[]) => {
    const graph = buildGraph(input);
    return renderMarkdown(graph, findViolations(graph));
  };

  it("is deterministic, regardless of input order", () => {
    const once = render(files);
    expect(render(files)).toBe(once);
    expect(render([...files].reverse())).toBe(once);
    expect(
      render([files[3], files[0], files[5], files[2], files[4], files[1]]),
    ).toBe(once);
  });

  it("emits Mermaid with sanitised ids and quoted labels", () => {
    const md = render(files);
    expect(md).toContain('    app_routes["app/routes (1)"]');
    expect(md).toContain('  storybook[".storybook (1)"]');
    expect(md).toContain("  app_routes -->|1| app_domain");
    expect(md).toContain("  scripts -->|1| app_domain");
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("lists violations under the layering rule", () => {
    expect(render(files)).toContain(
      "| `app/domain/bad.ts` | `react` | no        | app/domain must not import react |",
    );
  });

  it("ends with a single trailing newline", () => {
    const md = render(files.slice(0, 2));
    expect(md.endsWith("No violations.\n")).toBe(true);
  });
});

describe("mermaidId", () => {
  it("reduces layer names to alphanumerics and underscores", () => {
    expect(mermaidId("app (root)")).toBe("app_root");
    expect(mermaidId("app/rig/tools")).toBe("app_rig_tools");
    expect(mermaidId(".storybook")).toBe("storybook");
  });
});
