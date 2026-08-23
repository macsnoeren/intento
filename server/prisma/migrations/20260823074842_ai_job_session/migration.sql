-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "AiJob_sessionId_idx" ON "AiJob"("sessionId");
