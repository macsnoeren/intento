-- AlterTable
ALTER TABLE "CommunicationSession" ADD COLUMN "experienceCountedAt" DATETIME;

-- CreateTable
CREATE TABLE "ExperienceStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "presented" INTEGER NOT NULL DEFAULT 0,
    "chosen" INTEGER NOT NULL DEFAULT 0,
    "chosenAtFirstPosition" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExperienceStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperienceStat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExperienceStat_organizationId_idx" ON "ExperienceStat"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperienceStat_userId_subjectType_subjectRef_key" ON "ExperienceStat"("userId", "subjectType", "subjectRef");
