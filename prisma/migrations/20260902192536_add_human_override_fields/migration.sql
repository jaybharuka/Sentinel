-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "overriddenAt" TIMESTAMP(3),
ADD COLUMN     "overrideReason" TEXT;
