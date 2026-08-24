-- AlterTable
ALTER TABLE "MerchantSettings" ADD COLUMN "apiKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_apiKey_key" ON "MerchantSettings"("apiKey");
