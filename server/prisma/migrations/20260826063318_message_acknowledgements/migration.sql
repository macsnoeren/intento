-- CreateTable
CREATE TABLE "MessageAcknowledgement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageAcknowledgement_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "GeneratedMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageAcknowledgement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageAcknowledgement_messageId_key" ON "MessageAcknowledgement"("messageId");

-- CreateIndex
CREATE INDEX "MessageAcknowledgement_accountId_idx" ON "MessageAcknowledgement"("accountId");
