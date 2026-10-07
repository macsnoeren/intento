-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VocabularyItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "labels" JSONB NOT NULL,
    "concepts" JSONB NOT NULL,
    "contexts" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "conceptText" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_VocabularyItem" ("assetPath", "author", "authorUrl", "bytes", "concepts", "contexts", "createdAt", "createdById", "id", "importedAt", "isStart", "labelStatus", "labels", "licenseKey", "licenseUrl", "mimeType", "organizationId", "partOfSpeech", "searchText", "sha256", "sortOrder", "source", "sourceName", "sourceRef", "sourceUrl", "status", "updatedAt") SELECT "assetPath", "author", "authorUrl", "bytes", "concepts", "contexts", "createdAt", "createdById", "id", "importedAt", "isStart", "labelStatus", "labels", "licenseKey", "licenseUrl", "mimeType", "organizationId", "partOfSpeech", "searchText", "sha256", "sortOrder", "source", "sourceName", "sourceRef", "sourceUrl", "status", "updatedAt" FROM "VocabularyItem";
DROP TABLE "VocabularyItem";
ALTER TABLE "new_VocabularyItem" RENAME TO "VocabularyItem";
CREATE INDEX "VocabularyItem_organizationId_status_idx" ON "VocabularyItem"("organizationId", "status");
CREATE INDEX "VocabularyItem_status_labelStatus_idx" ON "VocabularyItem"("status", "labelStatus");
CREATE UNIQUE INDEX "VocabularyItem_sourceName_sourceRef_key" ON "VocabularyItem"("sourceName", "sourceRef");

-- N2.15: zoekvelden opnieuw opbouwen voor bestaande items, zoals `searchFields()` in de backend:
-- searchText = de labels, elk op een eigen regel, met een regeleinde ervoor en erachter;
-- conceptText = de conceptwoorden (underscore → spatie), elk met een spatie ervoor.
-- lower() van SQLite verkleint alleen ASCII; de labels zijn al kleine letters, en elke wijziging of
-- seed bouwt de velden opnieuw op in de backend.
UPDATE "VocabularyItem" SET
  "searchText" = char(10) || COALESCE((
    SELECT group_concat(lower(trim(value)), char(10))
    FROM (SELECT value FROM json_each("VocabularyItem"."labels") ORDER BY key)
  ), '') || char(10),
  "conceptText" = COALESCE((
    SELECT group_concat(' ' || lower(replace(trim(value), '_', ' ')), '')
    FROM (SELECT value FROM json_each("VocabularyItem"."concepts") ORDER BY key)
  ), '');
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
