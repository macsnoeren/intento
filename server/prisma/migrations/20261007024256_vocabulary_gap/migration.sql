-- CreateTable
CREATE TABLE "VocabularyGap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "context" TEXT,
    "bestAvailableItemId" TEXT,
    "lastConfidence" REAL NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    CONSTRAINT "VocabularyGap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VocabularyGap_bestAvailableItemId_fkey" FOREIGN KEY ("bestAvailableItemId") REFERENCES "VocabularyItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VocabularyGap_organizationId_status_lastSeenAt_idx" ON "VocabularyGap"("organizationId", "status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyGap_organizationId_conceptKey_key" ON "VocabularyGap"("organizationId", "conceptKey");
