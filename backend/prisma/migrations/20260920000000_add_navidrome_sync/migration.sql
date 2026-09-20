-- Add Navidrome sync settings.
ALTER TABLE "SystemSettings" ADD COLUMN "navidromeSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "navidromeUrl" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "navidromeUser" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "navidromePassword" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "navidromeNamePrefix" TEXT NOT NULL DEFAULT '';
