-- CreateTable
CREATE TABLE "CommunicationIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "messageEncrypted" TEXT NOT NULL,
    "concepts" JSONB NOT NULL,
    "confidence" REAL,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunicationIntent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationIntent_sessionId_key" ON "CommunicationIntent"("sessionId");

-- CreateIndex
CREATE INDEX "CommunicationIntent_organizationId_confirmedAt_idx" ON "CommunicationIntent"("organizationId", "confirmedAt");

-- CreateIndex
CREATE INDEX "CommunicationIntent_userId_confirmedAt_idx" ON "CommunicationIntent"("userId", "confirmedAt");
