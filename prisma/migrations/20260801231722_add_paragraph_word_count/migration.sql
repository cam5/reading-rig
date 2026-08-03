/*
  Warnings:

  - Added the required column `wordCount` to the `Paragraph` table without a default value. This is not possible if the table is not empty.

  Backfill: existing rows get wordCount computed in-place below by counting
  spaces in `text` (+1). Safe to equate with the app's real
  `countWords()` (app/domain/reading/readingTime.ts — trim().split(/\s+/).length)
  because ingest already collapses all whitespace runs to single spaces
  before storage (sanitizeHtml.ts's normalizeWhitespace) — there are no
  tabs, newlines, or repeated spaces in a stored `text` value for this
  expression to miscount. This originally shipped without a backfill and
  failed in production against real (non-empty) data — see RUNBOOK.md.
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Paragraph" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "globalOrdinal" INTEGER NOT NULL,
    "wordCount" INTEGER NOT NULL,
    CONSTRAINT "Paragraph_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Paragraph" ("globalOrdinal", "html", "id", "ordinal", "sectionId", "text", "wordCount")
SELECT "globalOrdinal", "html", "id", "ordinal", "sectionId", "text",
  CASE WHEN "text" = '' THEN 0 ELSE LENGTH("text") - LENGTH(REPLACE("text", ' ', '')) + 1 END
FROM "Paragraph";
DROP TABLE "Paragraph";
ALTER TABLE "new_Paragraph" RENAME TO "Paragraph";
CREATE INDEX "Paragraph_sectionId_idx" ON "Paragraph"("sectionId");
CREATE UNIQUE INDEX "Paragraph_sectionId_ordinal_key" ON "Paragraph"("sectionId", "ordinal");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
