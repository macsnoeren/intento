-- CreateTable
CREATE TABLE "AacSymbol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "concept" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "glyph" TEXT NOT NULL,
    "synonyms" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AacConceptRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'contains',
    CONSTRAINT "AacConceptRelation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AacSymbol" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AacConceptRelation_childId_fkey" FOREIGN KEY ("childId") REFERENCES "AacSymbol" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AacSymbol_concept_key" ON "AacSymbol"("concept");

-- CreateIndex
CREATE INDEX "AacSymbol_category_idx" ON "AacSymbol"("category");

-- CreateIndex
CREATE INDEX "AacConceptRelation_parentId_idx" ON "AacConceptRelation"("parentId");

-- CreateIndex
CREATE INDEX "AacConceptRelation_childId_idx" ON "AacConceptRelation"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "AacConceptRelation_parentId_childId_relation_key" ON "AacConceptRelation"("parentId", "childId", "relation");
