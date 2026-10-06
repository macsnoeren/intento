-- CreateTable
CREATE TABLE "PresentationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "optionsJson" JSONB NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresentationEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "optionRef" TEXT,
    "position" INTEGER,
    "responseTimeMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObservedEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Inference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "agent" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadEncrypted" TEXT NOT NULL,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Inference_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "agent" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "validation" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PresentationEvent_sessionId_turn_idx" ON "PresentationEvent"("sessionId", "turn");

-- CreateIndex
CREATE INDEX "ObservedEvent_sessionId_turn_idx" ON "ObservedEvent"("sessionId", "turn");

-- CreateIndex
CREATE INDEX "Inference_sessionId_turn_idx" ON "Inference"("sessionId", "turn");

-- CreateIndex
CREATE INDEX "AgentDecision_sessionId_turn_idx" ON "AgentDecision"("sessionId", "turn");
