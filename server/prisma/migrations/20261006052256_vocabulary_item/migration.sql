-- CreateTable
CREATE TABLE "VocabularyItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "labels" JSONB NOT NULL,
    "concepts" JSONB NOT NULL,
    "contexts" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "partOfSpeech" TEXT,
    "isStart" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "labelStatus" TEXT NOT NULL DEFAULT 'reviewed',
    "source" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "licenseUrl" TEXT,
    "author" TEXT,
    "authorUrl" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "sourceRef" TEXT,
    "importedAt" DATETIME,
    "assetPath" TEXT,
    "mimeType" TEXT,
    "sha256" TEXT,
    "bytes" INTEGER,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VocabularyItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VocabularyItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VocabularyItem_organizationId_status_idx" ON "VocabularyItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "VocabularyItem_status_labelStatus_idx" ON "VocabularyItem"("status", "labelStatus");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyItem_sourceName_sourceRef_key" ON "VocabularyItem"("sourceName", "sourceRef");
