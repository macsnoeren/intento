-- CreateTable
CREATE TABLE "CorrectionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'wrong_guess',
    "stepOrder" INTEGER NOT NULL,
    "rejectedConcept" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorrectionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CorrectionEvent_sessionId_idx" ON "CorrectionEvent"("sessionId");
