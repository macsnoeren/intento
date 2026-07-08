-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserCommunicationProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "iconsPerScreen" INTEGER NOT NULL DEFAULT 4,
    "showText" BOOLEAN NOT NULL DEFAULT true,
    "aiLearningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "supportMode" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "UserCommunicationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
