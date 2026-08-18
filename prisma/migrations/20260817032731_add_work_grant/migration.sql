-- CreateTable
CREATE TABLE "WorkGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkGrant_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Work" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isSeedWork" BOOLEAN NOT NULL DEFAULT false,
    "ingestWarnings" TEXT,
    "coverImage" BLOB,
    "coverMediaType" TEXT,
    CONSTRAINT "Work_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Work" ("author", "coverImage", "coverMediaType", "createdAt", "id", "ingestWarnings", "ownerId", "title", "updatedAt") SELECT "author", "coverImage", "coverMediaType", "createdAt", "id", "ingestWarnings", "ownerId", "title", "updatedAt" FROM "Work";
DROP TABLE "Work";
ALTER TABLE "new_Work" RENAME TO "Work";
CREATE INDEX "Work_ownerId_idx" ON "Work"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WorkGrant_workId_idx" ON "WorkGrant"("workId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkGrant_userId_workId_key" ON "WorkGrant"("userId", "workId");

