/*
  Warnings:

  - You are about to drop the `AacConceptRelation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AacSymbol` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AiJob` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ConceptProposal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ConversationSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ConversationStep` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CorrectionEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GeneratedMessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MessageAcknowledgement` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PersonalContext` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Preference` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkerToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `aiLearningEnabled` on the `UserCommunicationProfile` table. All the data in the column will be lost.
  - You are about to drop the column `contextIndicator` on the `UserCommunicationProfile` table. All the data in the column will be lost.
  - You are about to drop the column `conversationStrategy` on the `UserCommunicationProfile` table. All the data in the column will be lost.
  - You are about to drop the column `iconsPerScreen` on the `UserCommunicationProfile` table. All the data in the column will be lost.
  - You are about to drop the column `speechHints` on the `UserCommunicationProfile` table. All the data in the column will be lost.
  - You are about to drop the column `supportMode` on the `UserCommunicationProfile` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "AacConceptRelation_parentId_childId_relation_key";

-- DropIndex
DROP INDEX "AacConceptRelation_childId_idx";

-- DropIndex
DROP INDEX "AacConceptRelation_parentId_idx";

-- DropIndex
DROP INDEX "AacSymbol_reviewStatus_idx";

-- DropIndex
DROP INDEX "AacSymbol_category_idx";

-- DropIndex
DROP INDEX "AacSymbol_concept_key";

-- DropIndex
DROP INDEX "AiJob_sessionId_idx";

-- DropIndex
DROP INDEX "AiJob_claimedById_idx";

-- DropIndex
DROP INDEX "AiJob_status_createdAt_idx";

-- DropIndex
DROP INDEX "ConceptProposal_status_idx";

-- DropIndex
DROP INDEX "ConceptProposal_concept_key";

-- DropIndex
DROP INDEX "ConversationSession_userId_idx";

-- DropIndex
DROP INDEX "ConversationStep_sessionId_order_key";

-- DropIndex
DROP INDEX "ConversationStep_sessionId_idx";

-- DropIndex
DROP INDEX "CorrectionEvent_sessionId_idx";

-- DropIndex
DROP INDEX "GeneratedMessage_sessionId_idx";

-- DropIndex
DROP INDEX "MessageAcknowledgement_accountId_idx";

-- DropIndex
DROP INDEX "MessageAcknowledgement_messageId_key";

-- DropIndex
DROP INDEX "PersonalContext_userId_idx";

-- DropIndex
DROP INDEX "Preference_userId_concept_key";

-- DropIndex
DROP INDEX "Preference_userId_idx";

-- DropIndex
DROP INDEX "WorkerToken_revokedAt_idx";

-- DropIndex
DROP INDEX "WorkerToken_tokenHash_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AacConceptRelation";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AacSymbol";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AiJob";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ConceptProposal";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ConversationSession";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ConversationStep";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CorrectionEvent";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "GeneratedMessage";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MessageAcknowledgement";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PersonalContext";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Preference";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WorkerToken";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserCommunicationProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "showText" BOOLEAN NOT NULL DEFAULT true,
    "speechEnabled" BOOLEAN NOT NULL DEFAULT false,
    "speechVoice" TEXT NOT NULL DEFAULT 'nl_NL-pim-medium',
    CONSTRAINT "UserCommunicationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserCommunicationProfile" ("showText", "speechEnabled", "speechVoice", "userId") SELECT "showText", "speechEnabled", "speechVoice", "userId" FROM "UserCommunicationProfile";
DROP TABLE "UserCommunicationProfile";
ALTER TABLE "new_UserCommunicationProfile" RENAME TO "UserCommunicationProfile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
