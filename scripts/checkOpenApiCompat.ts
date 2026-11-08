import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  findBreakingChanges,
  hasBreakingChangeTrailer,
} from "../app/domain/api/openapiCompat.server";

// Compares the working tree's openapi/api-v1.json against the same file on
// BASE_REF (default origin/main) and fails on anything that would break a
// client already built against the base — see openapiCompat.server.ts for
// what counts, and MIGRATIONS.md's "API backward compatibility" section
// for the policy and the `API-Breaking-Change: <reason>` override.
//
// Compares committed specs, not live routes: openapi.server.test.ts is what
// keeps the committed file honest against buildOpenApiDocument().

const SPEC = "openapi/api-v1.json";
const baseRef = process.env.BASE_REF || "origin/main";

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

// A ref that doesn't resolve is a setup problem (CI didn't fetch the base
// branch), not "no spec yet" — fail loudly instead of passing silently.
try {
  git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
} catch {
  console.error(
    `api:compat — base ref ${baseRef} not found. Fetch it first (CI: actions/checkout fetch-depth: 0).`,
  );
  process.exit(2);
}

let baseText: string;
try {
  baseText = git(["show", `${baseRef}:${SPEC}`]);
} catch {
  console.log(
    `api:compat — no ${SPEC} on ${baseRef}; nothing to compare against, passing.`,
  );
  process.exit(0);
}

const headText = await readFile(
  path.join(import.meta.dirname, "..", SPEC),
  "utf8",
);

const findings = findBreakingChanges(
  JSON.parse(baseText),
  JSON.parse(headText),
);

if (findings.length === 0) {
  console.log(`api:compat — no breaking /api/v1 changes vs ${baseRef}.`);
  process.exit(0);
}

const lines = findings.map((f) => `  - [${f.kind}] ${f.path}: ${f.detail}`);

let commitMessages = "";
try {
  commitMessages = git(["log", "--format=%B", `${baseRef}..HEAD`]);
} catch {
  // No shared history with baseRef (shallow clone, bad ref) — treat as no
  // override rather than guessing.
}

if (hasBreakingChangeTrailer(commitMessages)) {
  console.warn(
    `api:compat — ${findings.length} breaking change(s) vs ${baseRef}, ` +
      `allowed by an API-Breaking-Change trailer:\n${lines.join("\n")}`,
  );
  process.exit(0);
}

console.error(
  `api:compat — ${findings.length} breaking change(s) to /api/v1 vs ${baseRef}:\n` +
    `${lines.join("\n")}\n\n` +
    "Installed iOS builds are generated from the base spec and will break. " +
    "Make the change additive (expand/contract, or a new /api/v2 route), or, " +
    "if the break is intentional and every client is accounted for, add an " +
    "`API-Breaking-Change: <reason>` trailer to a commit in this PR. " +
    "See MIGRATIONS.md → API backward compatibility.",
);
process.exit(1);
