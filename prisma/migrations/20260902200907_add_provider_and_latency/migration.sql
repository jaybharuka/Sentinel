-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "scoringLatencyMs" INTEGER;
