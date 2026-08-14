-- CreateTable
CREATE TABLE "Footnote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paragraphId" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    CONSTRAINT "Footnote_paragraphId_fkey" FOREIGN KEY ("paragraphId") REFERENCES "Paragraph" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Footnote_paragraphId_idx" ON "Footnote"("paragraphId");
