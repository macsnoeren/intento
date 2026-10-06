-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserCommunicationProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "interactionMode" TEXT NOT NULL DEFAULT 'binary',
    "optionsPerScreen" INTEGER NOT NULL DEFAULT 4,
    "questionStrategy" TEXT NOT NULL DEFAULT 'general_to_specific',
    "experienceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxQuestions" INTEGER NOT NULL DEFAULT 15,
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
