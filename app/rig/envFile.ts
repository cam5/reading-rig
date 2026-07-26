/**
 * Upserts `KEY=value` into the text of a `.env` file, preserving every
 * other line untouched. A pure string transform so `scripts/setup-agent.ts`
 * can be tested without touching disk: the script itself just reads the
 * file, calls this twice (agent id, agent version), and writes the result
 * back — the part worth a test is this rewrite rule, not the two fs calls
 * around it.
 *
 * Only matches an uncommented `KEY=...` line at the start of a line — a
 * commented-out placeholder like `# READING_RIG_AGENT_ID=` (as shipped in
 * .env.example) is left alone, and a new uncommented line is appended below
 * it. That's a one-time cosmetic wrinkle on the first run, not a bug: the
 * uncommented line is the one every later run will find and replace.
 */
export function upsertEnvVar(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(contents)) {
    return contents.replace(pattern, line);
  }

  if (contents.length === 0) {
    return `${line}\n`;
  }

  const withTrailingNewline = contents.endsWith("\n") ? contents : `${contents}\n`;
  return `${withTrailingNewline}${line}\n`;
}
