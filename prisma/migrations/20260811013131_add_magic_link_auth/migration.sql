/*
  Warnings:

  - Added the required column `email` to the `User` table without a default value. This is not possible if the table is not empty.

  Backfill: pre-magic-link User rows have no email at all (anonymous
  accounts, no email column previously existed) — this INSERT synthesizes a
  deterministic, unique placeholder (`legacy-<id>@reading-rig.invalid`) for
  every existing row rather than leaving the column unset, which fails NOT
  NULL against any populated database (see MIGRATIONS.md's wordCount
  incident — this is the same failure mode). Legacy users can't sign in via
  magic link with a placeholder address; that's an accepted, pre-existing
  consequence of this migration replacing anonymous auth wholesale, not
  something this backfill is trying to fix. `id` is a cuid, so uniqueness
  against the new User_email_key index is guaranteed.

  Idempotency: this migration failed against prod with the original
  (unbackfilled) INSERT below, at the exact statement it's always going to
  fail at if it fails at all — SQLite/Prisma here does not roll the whole
  script back on a mid-script error, so a failed run always leaves
  MagicLinkToken created and an empty, orphaned new_User sitting around
  with the original User table still intact. IF NOT EXISTS / DROP ... IF
  EXISTS below let a corrected retry resume cleanly from exactly that state
  instead of needing manual table surgery on every environment that hit
  the original bug.
*/
-- CreateTable
CREATE TABLE IF NOT EXISTS "MagicLinkToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS "new_User";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "id", "email") SELECT "createdAt", "id", 'legacy-' || "id" || '@reading-rig.invalid' FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_tokenHash_key" ON "MagicLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLinkToken_email_idx" ON "MagicLinkToken"("email");
