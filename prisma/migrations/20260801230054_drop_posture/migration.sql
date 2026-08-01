/*
  Warnings:

  - You are about to drop the column `posture` on the `Entry` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchorParagraphId" TEXT NOT NULL,
    "highlightId" TEXT,
    "contextSnapshot" JSONB NOT NULL,
    "rigSessionId" TEXT,
    "wovenIntoEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_anchorParagraphId_fkey" FOREIGN KEY ("anchorParagraphId") REFERENCES "Paragraph" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "Highlight" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_wovenIntoEntryId_fkey" FOREIGN KEY ("wovenIntoEntryId") REFERENCES "Entry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Entry" ("anchorParagraphId", "body", "contextSnapshot", "createdAt", "highlightId", "id", "origin", "rigSessionId", "userId", "wovenIntoEntryId") SELECT "anchorParagraphId", "body", "contextSnapshot", "createdAt", "highlightId", "id", "origin", "rigSessionId", "userId", "wovenIntoEntryId" FROM "Entry";
DROP TABLE "Entry";
ALTER TABLE "new_Entry" RENAME TO "Entry";
CREATE INDEX "Entry_anchorParagraphId_idx" ON "Entry"("anchorParagraphId");
CREATE INDEX "Entry_highlightId_idx" ON "Entry"("highlightId");
CREATE INDEX "Entry_userId_idx" ON "Entry"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
