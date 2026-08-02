/*
  Warnings:

  - Added the required column `wordCount` to the `Paragraph` table without a default value. This is not possible if the table is not empty.

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
INSERT INTO "new_Paragraph" ("globalOrdinal", "html", "id", "ordinal", "sectionId", "text") SELECT "globalOrdinal", "html", "id", "ordinal", "sectionId", "text" FROM "Paragraph";
DROP TABLE "Paragraph";
ALTER TABLE "new_Paragraph" RENAME TO "Paragraph";
CREATE INDEX "Paragraph_sectionId_idx" ON "Paragraph"("sectionId");
CREATE UNIQUE INDEX "Paragraph_sectionId_ordinal_key" ON "Paragraph"("sectionId", "ordinal");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
