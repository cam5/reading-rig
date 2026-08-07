-- CreateTable
CREATE TABLE "RigProvisioning" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "agentVersion" INTEGER NOT NULL,
    "environmentId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
