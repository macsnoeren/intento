-- CreateTable
CREATE TABLE "CommunicationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "currentTurn" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CommunicationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommunicationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "previousTurn" INTEGER,
    "stateEncrypted" TEXT NOT NULL,
    "presentationEncrypted" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CommunicationSession_userId_status_idx" ON "CommunicationSession"("userId", "status");

-- CreateIndex
CREATE INDEX "CommunicationSession_organizationId_startedAt_idx" ON "CommunicationSession"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTurn_sessionId_turn_key" ON "SessionTurn"("sessionId", "turn");
