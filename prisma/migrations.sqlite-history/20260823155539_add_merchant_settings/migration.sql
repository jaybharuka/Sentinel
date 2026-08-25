-- CreateTable
CREATE TABLE "MerchantSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" TEXT NOT NULL DEFAULT 'default_merchant',
    "autoRefundMaxAmount" INTEGER NOT NULL DEFAULT 2000,
    "dailyRefundCap" INTEGER NOT NULL DEFAULT 10000,
    "autoRefundMinRiskScore" REAL NOT NULL DEFAULT 0.9,
    "autoRefundMinConfidence" REAL NOT NULL DEFAULT 0.8,
    "holdForReviewMinRiskScore" REAL NOT NULL DEFAULT 0.6,
    "alertEmail" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_merchantId_key" ON "MerchantSettings"("merchantId");
