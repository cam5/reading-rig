-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "suggestedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ThreadEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    CONSTRAINT "ThreadEntry_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ThreadEntry_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ThreadEntry_threadId_idx" ON "ThreadEntry"("threadId");

-- CreateIndex
CREATE INDEX "ThreadEntry_entryId_idx" ON "ThreadEntry"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadEntry_threadId_entryId_key" ON "ThreadEntry"("threadId", "entryId");
