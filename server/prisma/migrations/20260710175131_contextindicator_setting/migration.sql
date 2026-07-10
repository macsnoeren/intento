-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserCommunicationProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "iconsPerScreen" INTEGER NOT NULL DEFAULT 4,
    "showText" BOOLEAN NOT NULL DEFAULT true,
    "aiLearningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "supportMode" BOOLEAN NOT NULL DEFAULT false,
    "contextIndicator" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "UserCommunicationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserCommunicationProfile" ("aiLearningEnabled", "iconsPerScreen", "showText", "supportMode", "userId") SELECT "aiLearningEnabled", "iconsPerScreen", "showText", "supportMode", "userId" FROM "UserCommunicationProfile";
DROP TABLE "UserCommunicationProfile";
ALTER TABLE "new_UserCommunicationProfile" RENAME TO "UserCommunicationProfile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
