-- AlterTable
ALTER TABLE "ConversationSession" ADD COLUMN "hypothesis" JSONB;
ALTER TABLE "ConversationSession" ADD COLUMN "pendingOffer" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConversationStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "selectedConcept" TEXT NOT NULL,
    "selectedSymbolId" TEXT,
    "confidence" REAL,
    "offeredConcepts" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConversationStep" ("confidence", "createdAt", "id", "order", "question", "selectedConcept", "selectedSymbolId", "sessionId") SELECT "confidence", "createdAt", "id", "order", "question", "selectedConcept", "selectedSymbolId", "sessionId" FROM "ConversationStep";
DROP TABLE "ConversationStep";
ALTER TABLE "new_ConversationStep" RENAME TO "ConversationStep";
CREATE INDEX "ConversationStep_sessionId_idx" ON "ConversationStep"("sessionId");
CREATE UNIQUE INDEX "ConversationStep_sessionId_order_key" ON "ConversationStep"("sessionId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
