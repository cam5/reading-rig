// The pure half of `npm run topology`: no fs, no child_process, so the
// whole pipeline — classify, parse, resolve, graph, check, render — can be
// tested on inline fixtures. scripts/topology.ts is the thin wrapper that
// feeds it `git ls-files` and writes TOPOLOGY.md.
//
// Layers are directories, not files: resolution stops at "which layer does
// this specifier land in", so `~/domain/locator` and `~/domain/locator.ts`
// are the same edge and nothing here needs to know about extensions.

export type Layer =
  | "app/domain"
  | "app/rig"
  | "app/rig/tools"
  | "app/components"
  | "app/routes"
  | "app/auth"
  | "app/styles"
  | "app (root)"
  | "lib"
  | "scripts"
  | "prisma"
  | "generated"
  | "ios"
  | "design"
  | ".storybook"
  | "other";

// Order matters: more specific prefixes first (app/rig/tools before app/rig).
const LAYER_PREFIXES: [string, Layer][] = [
  ["app/domain/", "app/domain"],
  ["app/rig/tools/", "app/rig/tools"],
  ["app/rig/", "app/rig"],
  ["app/components/", "app/components"],
  ["app/routes/", "app/routes"],
  ["app/auth/", "app/auth"],
  ["app/styles/", "app/styles"],
  ["lib/", "lib"],
  ["scripts/", "scripts"],
  ["prisma/", "prisma"],
  ["generated/", "generated"],
  ["ios/", "ios"],
  ["design/", "design"],
  [".storybook/", ".storybook"],
];

/** Maps a repo-relative, forward-slashed path to its architectural layer. */
export function classifyLayer(path: string): Layer {
  // `./+types/foo` is React Router's typegen output, which tsconfig's
  // rootDirs overlays onto the importing file's own directory.
  const p = path.replace(/^\.\//, "").replace(/\/\+types\//, "/");
  for (const [prefix, layer] of LAYER_PREFIXES) {
    if (p.startsWith(prefix)) return layer;
  }
  // Anything directly in app/ (root.tsx, routes.ts, *.server.ts, app.css)
  // but not in one of its subdirectories above.
  if (/^app\/[^/]+$/.test(p)) return "app (root)";
  return "other";
}

/**
 * The files the graph is built from, given NUL-split `git ls-files` output:
 * `listed` from `--cached --others --exclude-standard` (tracked, plus new
 * files not yet added — so `--check` agrees before and after the commit)
 * and `deleted` from `--deleted` (tracked but gone from disk, which would
 * otherwise be read and crash). Deduped (unmerged paths are listed once per
 * stage) and sorted, so the output doesn't depend on git's listing order.
 */
export function selectSourcePaths(
  listed: readonly string[],
  deleted: readonly string[],
): string[] {
  const gone = new Set(deleted);
  return [...new Set(listed)].filter((p) => p && !gone.has(p)).sort();
}

export type ImportKind =
  "static" | "side-effect" | "reexport" | "dynamic" | "require";

export interface ImportRecord {
  specifier: string;
  kind: ImportKind;
  typeOnly: boolean;
}

// Each is tried, sticky, at a code position where `import`/`export` starts.
// Specifier is always group 2 (group 1 is the opening quote, reused as a
// backreference so `'a"` doesn't match).
const IMPORT_PATTERNS: { re: RegExp; kind: ImportKind; typeOnly?: true }[] = [
  { re: /import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/y, kind: "dynamic" },
  {
    re: /import\s+type\s+[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1/y,
    kind: "static",
    typeOnly: true,
  },
  { re: /import\s*(['"])([^'"\n]+)\1/y, kind: "side-effect" },
  { re: /import\s+[^;'"()]*?\bfrom\s*(['"])([^'"\n]+)\1/y, kind: "static" },
  {
    re: /export\s+type\s+(?:\*|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/y,
    kind: "reexport",
    typeOnly: true,
  },
  {
    re: /export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/y,
    kind: "reexport",
  },
];

// CommonJS `require("…")`, tried at a code position where `require` starts.
const REQUIRE_PATTERN = /require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/y;

// A `/` after one of these (or after one of the keywords below) starts a
// regex literal rather than a division — the usual tokenizer heuristic,
// needed because a regex like /['"]/ would otherwise desync string skipping.
const REGEX_PRECEDERS = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else"]);

const isIdent = (c: string | undefined) => !!c && /[\w$]/.test(c);

/**
 * Finds import/re-export/dynamic-import/require specifiers in TS/JS source. A small
 * scanner rather than a bare regex over the text, so that `import ... from`
 * appearing inside a comment, a string or a template literal is ignored.
 */
export function extractImports(source: string): ImportRecord[] {
  const out: ImportRecord[] = [];
  const n = source.length;
  let i = 0;
  let lastSignificant = ""; // last non-space code char, for the regex heuristic
  let lastWord = "";

  const skipQuoted = (quote: string) => {
    i++;
    while (i < n && source[i] !== quote) {
      if (source[i] === "\\") i++;
      else if (quote !== "`" && source[i] === "\n") break;
      i++;
    }
    i++;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      skipQuoted(c);
      lastSignificant = c;
      lastWord = "";
      continue;
    }
    if (
      c === "/" &&
      // `</` is a JSX closing tag, not a regex. So is `/>` after `}` (as in
      // `<Foo {...p} />`); after anything else `/>` can only be a regex like
      // />"/, since an attribute string or a tag name isn't a regex preceder.
      lastSignificant !== "<" &&
      !(next === ">" && lastSignificant === "}") &&
      (lastSignificant === "" ||
        REGEX_PRECEDERS.has(lastSignificant) ||
        REGEX_KEYWORDS.has(lastWord))
    ) {
      i++;
      let inClass = false;
      while (i < n && source[i] !== "\n") {
        const r = source[i];
        if (r === "\\") i++;
        else if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        i++;
      }
      i++;
      lastSignificant = "/";
      lastWord = "";
      continue;
    }
    if (isIdent(c)) {
      const start = i;
      while (i < n && isIdent(source[i])) i++;
      const word = source.slice(start, i);
      const prev = source[start - 1];
      if (
        (word === "import" || word === "export") &&
        prev !== "." &&
        !isIdent(prev)
      ) {
        for (const { re, kind, typeOnly } of IMPORT_PATTERNS) {
          re.lastIndex = start;
          const m = re.exec(source);
          if (m) {
            out.push({ specifier: m[2], kind, typeOnly: !!typeOnly });
            i = re.lastIndex;
            break;
          }
        }
      } else if (word === "require" && prev !== "." && !isIdent(prev)) {
        REQUIRE_PATTERN.lastIndex = start;
        const m = REQUIRE_PATTERN.exec(source);
        if (m) {
          out.push({ specifier: m[2], kind: "require", typeOnly: false });
          i = REQUIRE_PATTERN.lastIndex;
        }
      }
      lastSignificant = source[i - 1];
      lastWord = word;
      continue;
    }
    if (!/\s/.test(c)) {
      lastSignificant = c;
      lastWord = "";
    }
    i++;
  }
  return out;
}

export type Resolved =
  { kind: "internal"; path: string } | { kind: "external"; pkg: string };

function normalize(parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Resolves an import specifier, as written in `fromPath`, to either a
 * repo-relative path or an external package name. `~/` is tsconfig's alias
 * for `./app/`. Vite-style `?url`/`?raw` suffixes are dropped.
 */
export function resolveSpecifier(fromPath: string, spec: string): Resolved {
  const s = spec.replace(/\?.*$/, "");
  if (s.startsWith("./") || s.startsWith("../") || s === "." || s === "..") {
    const dir = fromPath.split("/").slice(0, -1);
    return { kind: "internal", path: normalize([...dir, ...s.split("/")]) };
  }
  if (s.startsWith("~/")) {
    return {
      kind: "internal",
      path: normalize(["app", ...s.slice(2).split("/")]),
    };
  }
  if (s.startsWith("/")) {
    return { kind: "internal", path: normalize(s.split("/")) };
  }
  const segments = s.split("/");
  const pkg = s.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  return { kind: "external", pkg };
}

export interface SourceFile {
  path: string;
  /** Omitted for files that are counted but not parsed (Swift, CSS, …). */
  source?: string;
}

export interface FileImport {
  from: string;
  fromLayer: Layer;
  specifier: string;
  typeOnly: boolean;
  target: { kind: "layer"; layer: Layer } | { kind: "external"; pkg: string };
}

export interface LayerNode {
  layer: Layer;
  files: number;
  parsed: number;
}

export interface LayerEdge {
  from: Layer;
  to: Layer;
  count: number;
  typeOnly: number;
}

export interface Graph {
  layers: LayerNode[];
  edges: LayerEdge[];
  externals: { layer: Layer; packages: { pkg: string; count: number }[] }[];
  imports: FileImport[];
}

const LAYER_ORDER: Layer[] = [
  "app/routes",
  "app/components",
  "app/rig",
  "app/rig/tools",
  "app/domain",
  "app/auth",
  "app (root)",
  "app/styles",
  "lib",
  "generated",
  "prisma",
  "scripts",
  ".storybook",
  "ios",
  "design",
  "other",
];
const byLayerOrder = (a: Layer, b: Layer) =>
  LAYER_ORDER.indexOf(a) - LAYER_ORDER.indexOf(b);
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Collapses file-level imports into layer nodes and weighted layer→layer
 * edges. Imports within one layer are kept in `imports` but aren't edges.
 * Every output array is sorted, so input order never shows up in the result.
 */
export function buildGraph(files: SourceFile[]): Graph {
  const nodes = new Map<Layer, LayerNode>();
  const node = (layer: Layer) => {
    let n = nodes.get(layer);
    if (!n) nodes.set(layer, (n = { layer, files: 0, parsed: 0 }));
    return n;
  };
  const edges = new Map<string, LayerEdge>();
  const externals = new Map<Layer, Map<string, number>>();
  const imports: FileImport[] = [];

  for (const file of files) {
    const fromLayer = classifyLayer(file.path);
    const n = node(fromLayer);
    n.files++;
    if (file.source === undefined) continue;
    n.parsed++;

    for (const imp of extractImports(file.source)) {
      const resolved = resolveSpecifier(file.path, imp.specifier);
      if (resolved.kind === "external") {
        imports.push({
          from: file.path,
          fromLayer,
          specifier: imp.specifier,
          typeOnly: imp.typeOnly,
          target: { kind: "external", pkg: resolved.pkg },
        });
        const pkgs = externals.get(fromLayer) ?? new Map<string, number>();
        pkgs.set(resolved.pkg, (pkgs.get(resolved.pkg) ?? 0) + 1);
        externals.set(fromLayer, pkgs);
        continue;
      }
      const toLayer = classifyLayer(resolved.path);
      imports.push({
        from: file.path,
        fromLayer,
        specifier: imp.specifier,
        typeOnly: imp.typeOnly,
        target: { kind: "layer", layer: toLayer },
      });
      if (toLayer === fromLayer) continue;
      node(toLayer); // e.g. generated/, untracked but imported
      const key = `${fromLayer}\0${toLayer}`;
      const edge = edges.get(key) ?? {
        from: fromLayer,
        to: toLayer,
        count: 0,
        typeOnly: 0,
      };
      edge.count++;
      if (imp.typeOnly) edge.typeOnly++;
      edges.set(key, edge);
    }
  }

  return {
    layers: [...nodes.values()].sort((a, b) => byLayerOrder(a.layer, b.layer)),
    edges: [...edges.values()].sort(
      (a, b) => byLayerOrder(a.from, b.from) || byLayerOrder(a.to, b.to),
    ),
    externals: [...externals.entries()]
      .sort(([a], [b]) => byLayerOrder(a, b))
      .map(([layer, pkgs]) => ({
        layer,
        packages: [...pkgs.entries()]
          .map(([pkg, count]) => ({ pkg, count }))
          .sort((a, b) => byString(a.pkg, b.pkg)),
      })),
    imports: imports.sort(
      (a, b) => byString(a.from, b.from) || byString(a.specifier, b.specifier),
    ),
  };
}

// README: "app/domain/ is deliberately free of React and of the Anthropic
// SDK." Type-only imports count too — a type from react-router in a domain
// signature is still the domain knowing about React Router.
const DOMAIN_FORBIDDEN_PACKAGES = new Set([
  "react",
  "react-dom",
  "react-router",
  "@anthropic-ai/sdk",
]);
const DOMAIN_FORBIDDEN_LAYERS = new Set<Layer>([
  "app/components",
  "app/routes",
]);

export interface Violation {
  file: string;
  specifier: string;
  typeOnly: boolean;
  reason: string;
}

export function findViolations(graph: Graph): Violation[] {
  const out: Violation[] = [];
  for (const imp of graph.imports) {
    if (imp.fromLayer !== "app/domain") continue;
    const t = imp.target;
    if (t.kind === "external" && DOMAIN_FORBIDDEN_PACKAGES.has(t.pkg)) {
      out.push({
        file: imp.from,
        specifier: imp.specifier,
        typeOnly: imp.typeOnly,
        reason: `app/domain must not import ${t.pkg}`,
      });
    } else if (t.kind === "layer" && DOMAIN_FORBIDDEN_LAYERS.has(t.layer)) {
      out.push({
        file: imp.from,
        specifier: imp.specifier,
        typeOnly: imp.typeOnly,
        reason: `app/domain must not import from ${t.layer}`,
      });
    }
  }
  return out;
}

/** Mermaid node id: alphanumerics and underscores only. */
export function mermaidId(layer: Layer): string {
  return layer.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Padded the way Prettier pads Markdown tables, so `npm run format:check`
// and `npm run topology -- --check` agree on what the file should be.
function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, col) =>
    Math.max(3, h.length, ...rows.map((r) => r[col].length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((c, col) => c.padEnd(widths[col])).join(" | ")} |`;
  return [
    line(header),
    `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`,
    ...rows.map(line),
  ];
}

const code = (s: string) => `\`${s}\``;

export function renderMarkdown(graph: Graph, violations: Violation[]): string {
  const lines: string[] = [
    "# Topology",
    "",
    "<!-- Generated by `npm run topology` (scripts/topology.ts). Do not edit by hand. -->",
    "",
    "Imports between the repo's architectural layers, from every `.ts`, `.tsx`",
    "and `.mjs` file git tracks. Edge labels are import counts (type-only",
    "imports included); imports within a layer aren't drawn. Regenerate with",
    "`npm run topology`; `npm run topology -- --check` fails if this file is",
    "stale or the layering rule below is broken.",
    "",
    "## Layer graph",
    "",
    "```mermaid",
    "flowchart LR",
  ];

  const connected = new Set<Layer>();
  for (const e of graph.edges) connected.add(e.from).add(e.to);
  const drawn = graph.layers.filter((l) => connected.has(l.layer));
  // generated/ is gitignored, so it has no tracked files to count.
  const label = (l: LayerNode) =>
    l.files > 0 ? `${l.layer} (${l.files})` : l.layer;

  const appNodes = drawn.filter((l) => l.layer.startsWith("app"));
  if (appNodes.length > 0) {
    lines.push('  subgraph app_dir["app/"]');
    for (const l of appNodes) {
      lines.push(`    ${mermaidId(l.layer)}["${label(l)}"]`);
    }
    lines.push("  end");
  }
  for (const l of drawn.filter((l) => !l.layer.startsWith("app"))) {
    lines.push(`  ${mermaidId(l.layer)}["${label(l)}"]`);
  }
  for (const e of graph.edges) {
    lines.push(`  ${mermaidId(e.from)} -->|${e.count}| ${mermaidId(e.to)}`);
  }
  lines.push("```", "");

  lines.push(
    "## Layers",
    "",
    "Files is every tracked file in the layer (Swift, CSS, migrations, …);",
    "Parsed is the subset read for imports. `generated` is gitignored, so it",
    "only appears as an import target.",
    "",
    ...table(
      ["Layer", "Files", "Parsed"],
      graph.layers.map((l) => [
        code(l.layer),
        String(l.files),
        String(l.parsed),
      ]),
    ),
    "",
    "## Edges",
    "",
    ...table(
      ["From", "To", "Imports", "Type-only"],
      graph.edges.map((e) => [
        code(e.from),
        code(e.to),
        String(e.count),
        String(e.typeOnly),
      ]),
    ),
    "",
    "## External packages",
    "",
    ...table(
      ["Layer", "Packages (import count)"],
      graph.externals.map(({ layer, packages }) => [
        code(layer),
        packages.map((p) => `${code(p.pkg)} ${p.count}`).join(", "),
      ]),
    ),
    "",
    "## Layering rule",
    "",
    "`app/domain/` is deliberately free of React and of the Anthropic SDK",
    "(README, Layout): it must not import `react`, `react-dom`, `react-router`,",
    "`@anthropic-ai/sdk`, `app/components` or `app/routes` — type-only imports",
    "included.",
    "",
  );
  if (violations.length === 0) {
    lines.push("No violations.", "");
  } else {
    lines.push(
      ...table(
        ["File", "Import", "Type-only", "Rule"],
        violations.map((v) => [
          code(v.file),
          code(v.specifier),
          v.typeOnly ? "yes" : "no",
          v.reason,
        ]),
      ),
      "",
    );
  }
  return lines.join("\n");
}
