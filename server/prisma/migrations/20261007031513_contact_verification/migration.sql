-- CreateTable
CREATE TABLE "ContactVerificationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "usedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactVerificationToken_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactVerificationToken_tokenHash_key" ON "ContactVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ContactVerificationToken_contactId_idx" ON "ContactVerificationToken"("contactId");
