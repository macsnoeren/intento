-- CreateTable
CREATE TABLE "GeneratedMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GeneratedMessage_sessionId_idx" ON "GeneratedMessage"("sessionId");
