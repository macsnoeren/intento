-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConversationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mode" TEXT NOT NULL DEFAULT 'free',
    "caregiverQuestion" TEXT,
    "startedByAccountId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConversationSession" ("id", "startedAt", "status", "userId") SELECT "id", "startedAt", "status", "userId" FROM "ConversationSession";
DROP TABLE "ConversationSession";
ALTER TABLE "new_ConversationSession" RENAME TO "ConversationSession";
CREATE INDEX "ConversationSession_userId_idx" ON "ConversationSession"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
