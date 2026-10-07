-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "contactId" TEXT,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'sending',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "Delivery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Delivery_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "CommunicationIntent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Delivery_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Delivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Delivery_organizationId_createdAt_idx" ON "Delivery"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_userId_createdAt_idx" ON "Delivery"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_sessionId_contactId_key" ON "Delivery"("sessionId", "contactId");
