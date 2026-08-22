-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AacSymbol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "concept" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "glyph" TEXT NOT NULL,
    "imageData" BLOB,
    "imageMimeType" TEXT,
    "imageVersion" INTEGER NOT NULL DEFAULT 0,
    "imageLicense" TEXT,
    "imageLicenseUrl" TEXT,
    "imageAuthor" TEXT,
    "imageAuthorUrl" TEXT,
    "imageSourceUrl" TEXT,
    "synonyms" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'library',
    "reviewStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AacSymbol" ("category", "concept", "createdAt", "glyph", "id", "imageAuthor", "imageAuthorUrl", "imageData", "imageLicense", "imageLicenseUrl", "imageMimeType", "imageSourceUrl", "imageVersion", "label", "searchText", "synonyms") SELECT "category", "concept", "createdAt", "glyph", "id", "imageAuthor", "imageAuthorUrl", "imageData", "imageLicense", "imageLicenseUrl", "imageMimeType", "imageSourceUrl", "imageVersion", "label", "searchText", "synonyms" FROM "AacSymbol";
DROP TABLE "AacSymbol";
ALTER TABLE "new_AacSymbol" RENAME TO "AacSymbol";
CREATE UNIQUE INDEX "AacSymbol_concept_key" ON "AacSymbol"("concept");
CREATE INDEX "AacSymbol_category_idx" ON "AacSymbol"("category");
CREATE INDEX "AacSymbol_reviewStatus_idx" ON "AacSymbol"("reviewStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
