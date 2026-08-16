import {
  chmodSync,
  existsSync,
  symlinkSync,
  unlinkSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// git doesn't version hooks — .git/hooks is local-only, and for worktrees
// it's the *shared* directory (git rev-parse --git-common-dir), not
// per-worktree. Symlinking the checked-in source in scripts/git-hooks/
// means editing a hook here takes effect everywhere immediately, no
// reinstall step. Falls back to a copy if symlinking isn't available
// (e.g. Windows without dev mode).
//
// Run via `postinstall`, so hooks are live after any `npm install` — see
// the design-token-hook PR for why this exists (a post-commit reminder
// when organic.css's tokens change, pointing at the Figma mirror).

const HOOKS_SOURCE_DIR = path.join(import.meta.dirname, "git-hooks");
const HOOK_NAMES = ["post-commit", "pre-commit"];

function gitCommonDir(): string | null {
  try {
    const dir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  } catch {
    // No .git here — a deploy build (Railway, etc.) rather than a dev
    // checkout. Hooks are a local-dev nicety, not something that should
    // ever fail `npm install`.
    return null;
  }
}

function installHook(name: string, hooksDir: string) {
  const source = path.join(HOOKS_SOURCE_DIR, name);
  const dest = path.join(hooksDir, name);

  chmodSync(source, 0o755);

  if (existsSync(dest)) unlinkSync(dest);
  try {
    symlinkSync(source, dest);
  } catch {
    copyFileSync(source, dest);
    chmodSync(dest, 0o755);
  }
  console.log(`  ${name} -> ${dest}`);
}

function main() {
  const commonDir = gitCommonDir();
  if (!commonDir) return;

  const hooksDir = path.join(commonDir, "hooks");
  console.log("Installing git hooks:");
  for (const name of HOOK_NAMES) installHook(name, hooksDir);
}

main();
