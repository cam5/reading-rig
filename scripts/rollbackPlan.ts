import { execFileSync } from "node:child_process";
import {
  classifyChanges,
  rangeGitArgs,
  renderRollbackPlan,
  type ChangedFile,
} from "./lib/rollbackPlan";

// `npm run rollback:plan -- [<base>] [<head>] [--json]`
//
// Advisory only: prints how the change set base..head would be rolled back
// under this repo's deploy model (see scripts/lib/rollbackPlan.ts). It only
// *reads* git — no Railway calls, no database, no checkout/commit — and
// always exits 0, so it's safe to run anywhere and is not a CI gate.
//
// Defaults: base = origin/main, head = HEAD. Either way the diff is taken
// from their merge-base, as a PR would show it.

const args = process.argv.slice(2);
const json = args.includes("--json");
const [baseArg, headArg] = args.filter((a) => !a.startsWith("--"));

function git(...gitArgs: string[]): string {
  return execFileSync("git", gitArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function showAt(rev: string, path: string): string | undefined {
  try {
    return git("show", "--end-of-options", `${rev}:${path}`);
  } catch {
    return undefined;
  }
}

try {
  const range = rangeGitArgs(baseArg, headArg);
  const head = range.head;
  const base = git(...range.mergeBase).trim();

  const files: ChangedFile[] = git(...range.diff)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      const file: ChangedFile = { status: status[0], path };
      if (
        status === "A" &&
        /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(path)
      ) {
        file.contents = showAt(head, path);
      }
      if (path === "package.json") {
        file.contents = showAt(head, path);
        file.baseContents = showAt(base, path);
      }
      return file;
    });

  const categories = classifyChanges(files);
  if (json) {
    console.log(JSON.stringify(categories, null, 2));
  } else {
    process.stdout.write(
      renderRollbackPlan(categories, {
        base: git("rev-parse", "--short", "--end-of-options", base).trim(),
        head: git("rev-parse", "--short", "--end-of-options", head).trim(),
      }),
    );
  }
} catch (error) {
  // Advisory, not a gate: report and still exit 0.
  console.error(
    `rollback:plan could not read the change set: ${error instanceof Error ? error.message : String(error)}`,
  );
}
