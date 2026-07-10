-- CreateTable
CREATE TABLE "ConceptProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "concept" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "linkedSymbolId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ConceptProposal_concept_key" ON "ConceptProposal"("concept");

-- CreateIndex
CREATE INDEX "ConceptProposal_status_idx" ON "ConceptProposal"("status");
