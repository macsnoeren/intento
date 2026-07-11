-- CreateTable
CREATE TABLE "WorkerToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'ai:process',
    "revokedAt" DATETIME,
    "expiresAt" DATETIME,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "payloadJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedById" TEXT,
    "claimedAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiJob_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "WorkerToken" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerToken_tokenHash_key" ON "WorkerToken"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkerToken_revokedAt_idx" ON "WorkerToken"("revokedAt");

-- CreateIndex
CREATE INDEX "AiJob_status_createdAt_idx" ON "AiJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_claimedById_idx" ON "AiJob"("claimedById");
