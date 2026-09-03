-- Forces regeneration for every merchant with an existing plaintext key:
-- a plaintext key cannot be un-hashed, so this is the only safe option
-- pre-launch. Merchants regenerate from /settings, at which point they see
-- the new full key exactly once.

-- DropIndex
DROP INDEX "MerchantSettings_apiKey_key";

-- AlterTable
ALTER TABLE "MerchantSettings" DROP COLUMN "apiKey",
ADD COLUMN     "apiKeyHash" TEXT,
ADD COLUMN     "apiKeyPrefix" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_apiKeyHash_key" ON "MerchantSettings"("apiKeyHash");
