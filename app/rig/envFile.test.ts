import { describe, expect, it } from "vitest";
import { upsertEnvVar } from "./envFile";

describe("upsertEnvVar", () => {
  it("appends to an empty file", () => {
    expect(upsertEnvVar("", "READING_RIG_AGENT_ID", "agent_123")).toBe(
      "READING_RIG_AGENT_ID=agent_123\n",
    );
  });

  it("appends a new key after existing content, adding a missing trailing newline", () => {
    const contents = 'DATABASE_URL="file:./dev.db"';
    expect(upsertEnvVar(contents, "READING_RIG_AGENT_ID", "agent_123")).toBe(
      'DATABASE_URL="file:./dev.db"\nREADING_RIG_AGENT_ID=agent_123\n',
    );
  });

  it("replaces an existing uncommented value in place, preserving surrounding lines", () => {
    const contents = ["DATABASE_URL=file:./dev.db", "READING_RIG_AGENT_ID=agent_old", "FOO=bar"].join(
      "\n",
    );
    const result = upsertEnvVar(contents, "READING_RIG_AGENT_ID", "agent_new");
    expect(result).toBe(
      ["DATABASE_URL=file:./dev.db", "READING_RIG_AGENT_ID=agent_new", "FOO=bar"].join("\n"),
    );
  });

  it("leaves a commented-out placeholder alone and appends the real value", () => {
    const contents = "# READING_RIG_AGENT_ID=\n";
    const result = upsertEnvVar(contents, "READING_RIG_AGENT_ID", "agent_123");
    expect(result).toBe("# READING_RIG_AGENT_ID=\nREADING_RIG_AGENT_ID=agent_123\n");
  });

  it("updates only the matching key when two keys share a prefix", () => {
    const contents = "READING_RIG_AGENT_ID=agent_123\nREADING_RIG_AGENT_ID_BACKUP=agent_999\n";
    const result = upsertEnvVar(contents, "READING_RIG_AGENT_ID", "agent_456");
    expect(result).toBe("READING_RIG_AGENT_ID=agent_456\nREADING_RIG_AGENT_ID_BACKUP=agent_999\n");
  });
});
