-- CreateTable
CREATE TABLE "UserNavidromeSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "navidromeUser" TEXT,
    "navidromePassword" TEXT,
    "namePrefix" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNavidromeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNavidromeSettings_userId_key" ON "UserNavidromeSettings"("userId");

-- AddForeignKey
ALTER TABLE "UserNavidromeSettings" ADD CONSTRAINT "UserNavidromeSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
