-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountSetupCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accountSetupCompletedAt" TIMESTAMP(3),
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);
