import { describe, expect, it } from "vitest";
import {
  classifyChanges,
  findDestructiveStatements,
  maxRisk,
  renderRollbackPlan,
  type ChangedFile,
} from "./rollbackPlan";

const range = { base: "aaa", head: "bbb" };
const plan = (files: ChangedFile[]) => {
  const categories = classifyChanges(files);
  return {
    categories,
    md: renderRollbackPlan(categories, range),
    ids: categories.map((c) => c.id),
  };
};

const NULLABLE_ADD = `-- AlterTable
ALTER TABLE "Work" ADD COLUMN "coverImage" BLOB;
`;

const DROP_VIA_REDEFINE = `/*
  Warnings:
  - You are about to drop the column \`posture\` on the \`Entry\` table.
*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Entry" ("id" TEXT NOT NULL PRIMARY KEY);
INSERT INTO "new_Entry" ("id") SELECT "id" FROM "Entry";
DROP TABLE "Entry";
ALTER TABLE "new_Entry" RENAME TO "Entry";
PRAGMA foreign_keys=ON;
`;

const migration = (name: string, contents: string): ChangedFile => ({
  status: "A",
  path: `prisma/migrations/${name}/migration.sql`,
  contents,
});

describe("classifyChanges / renderRollbackPlan", () => {
  it("code-only diff is low risk with redeploy guidance", () => {
    const { categories, md, ids } = plan([
      { status: "M", path: "app/routes/read.tsx" },
      { status: "A", path: "lib/paged-columns/src/index.ts" },
    ]);
    expect(ids).toEqual(["app"]);
    expect(maxRisk(categories)).toBe("low");
    expect(md).toContain("**Overall risk: LOW**");
    expect(md).toMatch(/redeploy the production deployment/);
    expect(md).toContain("/healthz");
    expect(md).not.toContain("Snapshot the production volume");
  });

  it("nullable ADD COLUMN migration is medium and forward-only", () => {
    const { categories, md } = plan([
      { status: "M", path: "prisma/schema.prisma" },
      migration("20260901000000_add_cover", NULLABLE_ADD),
    ]);
    expect(categories.map((c) => c.id)).toEqual(["migration"]);
    expect(maxRisk(categories)).toBe("medium");
    expect(md).toContain("FORWARD-ONLY");
    expect(md).toContain("compensating migration");
    expect(md).toContain("staging-qa");
    expect(md).not.toContain("Snapshot the production volume");
  });

  it("DROP COLUMN / RedefineTables migration is high with a backup step", () => {
    const { categories, md } = plan([
      migration("20260901000000_drop_posture", DROP_VIA_REDEFINE),
    ]);
    expect(maxRisk(categories)).toBe("high");
    expect(md).toContain("**Overall risk: HIGH**");
    expect(md).toContain("RedefineTables");
    expect(md).toContain("Snapshot the production volume's db file");
    expect(md).toContain("Before any manual write against the live database");

    const plain = plan([
      migration(
        "20260901000001_drop",
        'ALTER TABLE "Work" DROP COLUMN "subtitle";',
      ),
    ]);
    expect(maxRisk(plain.categories)).toBe("high");
    expect(plain.md).toContain("DROP COLUMN");
  });

  it("editing an already-applied migration is high", () => {
    const { categories, md } = plan([
      {
        status: "M",
        path: "prisma/migrations/20260801165529_baseline/migration.sql",
      },
    ]);
    expect(maxRisk(categories)).toBe("high");
    expect(md).toContain("was modified");
  });

  it("schema.prisma without a migration warns about drift", () => {
    const { ids, md } = plan([{ status: "M", path: "prisma/schema.prisma" }]);
    expect(ids).toEqual(["schema-drift"]);
    expect(md).toContain("no migration was added");
    expect(md).toContain("migrate diff --exit-code");
  });

  it("ios-only and docs-only diffs need no Railway action", () => {
    for (const files of [
      [{ status: "M", path: "ios/ReadingRig/ContentView.swift" }],
      [
        { status: "M", path: "RUNBOOK.md" },
        { status: "M", path: ".github/workflows/ci.yml" },
      ],
    ]) {
      const { categories, md } = plan(files);
      expect(categories.every((c) => !c.railway)).toBe(true);
      expect(maxRisk(categories)).toBe("low");
      expect(md).toContain("Nothing in this change set deploys to Railway.");
      expect(md).not.toMatch(/redeploy/i);
    }
    expect(plan([{ status: "M", path: "ios/x.swift" }]).md).toContain(
      "TestFlight",
    );
  });

  it("package.json splits into pipeline vs dependency changes", () => {
    const before = JSON.stringify({
      scripts: { start: "npm run release && serve" },
      dependencies: { zod: "^4" },
    });
    const startOnly = plan([
      {
        status: "M",
        path: "package.json",
        baseContents: before,
        contents: JSON.stringify({
          scripts: { start: "serve" },
          dependencies: { zod: "^4" },
        }),
      },
    ]);
    expect(startOnly.ids).toEqual(["pipeline"]);

    const depsOnly = plan([
      {
        status: "M",
        path: "package.json",
        baseContents: before,
        contents: JSON.stringify({
          scripts: { start: "npm run release && serve" },
          dependencies: { zod: "^5" },
        }),
      },
    ]);
    const devScriptOnly = plan([
      {
        status: "M",
        path: "package.json",
        baseContents: before,
        contents: JSON.stringify({
          scripts: { start: "npm run release && serve", "api-token": "tsx x" },
          dependencies: { zod: "^4" },
        }),
      },
    ]);
    expect(devScriptOnly.ids).toEqual(["no-runtime"]);

    expect(depsOnly.ids).toEqual(["dependencies"]);
    expect(depsOnly.md).toContain("package-lock.json did not");
  });

  it("seed/ingest-only diffs are low risk: prod deploys never run them", () => {
    const { ids, categories, md } = plan([
      { status: "M", path: "prisma/seed.ts" },
      { status: "M", path: "scripts/ingest.ts" },
      { status: "M", path: "scripts/seedLibrary.ts" },
    ]);
    expect(ids).toEqual(["seed-data"]);
    expect(maxRisk(categories)).toBe("low");
    expect(categories.every((c) => !c.railway)).toBe(true);
    expect(md).toContain("Nothing in this change set deploys to Railway.");
    expect(md).toContain("Production runs `deployMigrations()` alone");
    expect(md).toContain("only gets these rows from a manual run");
  });

  it("mixed diff takes the max risk and renders every section", () => {
    const { categories, md } = plan([
      { status: "M", path: "app/root.tsx" },
      migration("20260901000000_drop_posture", DROP_VIA_REDEFINE),
      { status: "M", path: "prisma/schema.prisma" },
      { status: "M", path: "prisma/seed.ts" },
      { status: "M", path: "railway.toml" },
      { status: "M", path: "package-lock.json" },
      { status: "M", path: "ios/App.swift" },
      { status: "M", path: "MIGRATIONS.md" },
    ]);
    expect(maxRisk(categories)).toBe("high");
    for (const title of [
      "App/server code",
      "Prisma migrations",
      "Seed/ingest scripts",
      "Deploy pipeline",
      "Dependencies",
      "iOS app",
      "No runtime effect",
    ]) {
      expect(md).toContain(`### ${title}`);
    }
    // A migration came with the schema change, so no drift warning.
    expect(md).not.toContain("no migration was added");
  });

  it("empty range renders a no-op plan", () => {
    expect(plan([]).md).toContain("No changes in this range.");
  });
});

describe("findDestructiveStatements", () => {
  it("ignores additive SQL and prose in comments", () => {
    expect(findDestructiveStatements(NULLABLE_ADD)).toEqual([]);
    expect(
      findDestructiveStatements(
        `/* this used to DROP TABLE and DELETE FROM things */\n-- UPDATE x SET y\nCREATE TABLE "A" ("id" TEXT NOT NULL PRIMARY KEY);`,
      ),
    ).toEqual([]);
  });

  it("flags NOT NULL adds without a DEFAULT, and data statements", () => {
    expect(
      findDestructiveStatements(
        'ALTER TABLE "Paragraph" ADD COLUMN "wordCount" INTEGER NOT NULL;',
      ),
    ).toEqual(["ADD COLUMN … NOT NULL without DEFAULT"]);
    expect(
      findDestructiveStatements(
        'ALTER TABLE "Paragraph" ADD COLUMN "wordCount" INTEGER NOT NULL DEFAULT 0;',
      ),
    ).toEqual([]);
    expect(
      findDestructiveStatements('UPDATE "User" SET "email" = \'x\';'),
    ).toEqual(["UPDATE"]);
    expect(findDestructiveStatements('DELETE FROM "Session";')).toEqual([
      "DELETE",
    ]);
  });
});
