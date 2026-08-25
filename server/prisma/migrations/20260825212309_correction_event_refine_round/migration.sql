-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CorrectionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'wrong_guess',
    "stepOrder" INTEGER NOT NULL,
    "rejectedConcept" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorrectionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CorrectionEvent" ("createdAt", "id", "rejectedConcept", "sessionId", "stepOrder", "type") SELECT "createdAt", "id", "rejectedConcept", "sessionId", "stepOrder", "type" FROM "CorrectionEvent";
DROP TABLE "CorrectionEvent";
ALTER TABLE "new_CorrectionEvent" RENAME TO "CorrectionEvent";
CREATE INDEX "CorrectionEvent_sessionId_idx" ON "CorrectionEvent"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
