-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resetToken" TEXT,
ADD COLUMN     "resetTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "verificationToken" TEXT,
ADD COLUMN     "verificationTokenExpiry" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_verificationToken_key" ON "Merchant"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_resetToken_key" ON "Merchant"("resetToken");
