-- DropIndex
DROP INDEX "RigSession_userId_workId_key";

-- CreateIndex
CREATE INDEX "RigSession_userId_workId_createdAt_idx" ON "RigSession"("userId", "workId", "createdAt");
