-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed the default merchant. id is a fixed literal (not cuid()-generated)
-- so it matches the "default_merchant" value MerchantSettings.merchantId
-- already carried from stage 1, and so app code can hard-code it as a
-- constant without a DB round-trip to discover it.
INSERT INTO "Merchant" ("id", "name", "email", "createdAt")
VALUES ('default_merchant', 'Demo Merchant', 'merchant-test@example.com', CURRENT_TIMESTAMP);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Alert" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" TEXT NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "sentTo" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Alert_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Alert" ("body", "createdAt", "id", "sentTo", "subject", "transactionId", "merchantId")
SELECT "body", "createdAt", "id", "sentTo", "subject", "transactionId", 'default_merchant' FROM "Alert";
DROP TABLE "Alert";
ALTER TABLE "new_Alert" RENAME TO "Alert";
CREATE TABLE "new_MerchantSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" TEXT NOT NULL,
    "autoRefundMaxAmount" INTEGER NOT NULL DEFAULT 2000,
    "dailyRefundCap" INTEGER NOT NULL DEFAULT 10000,
    "autoRefundMinRiskScore" REAL NOT NULL DEFAULT 0.9,
    "autoRefundMinConfidence" REAL NOT NULL DEFAULT 0.8,
    "holdForReviewMinRiskScore" REAL NOT NULL DEFAULT 0.6,
    "alertEmail" TEXT,
    "apiKey" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MerchantSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MerchantSettings" ("alertEmail", "apiKey", "autoRefundMaxAmount", "autoRefundMinConfidence", "autoRefundMinRiskScore", "dailyRefundCap", "holdForReviewMinRiskScore", "id", "merchantId", "updatedAt")
SELECT "alertEmail", "apiKey", "autoRefundMaxAmount", "autoRefundMinConfidence", "autoRefundMinRiskScore", "dailyRefundCap", "holdForReviewMinRiskScore", "id", "merchantId", "updatedAt" FROM "MerchantSettings";
DROP TABLE "MerchantSettings";
ALTER TABLE "new_MerchantSettings" RENAME TO "MerchantSettings";
CREATE UNIQUE INDEX "MerchantSettings_merchantId_key" ON "MerchantSettings"("merchantId");
CREATE UNIQUE INDEX "MerchantSettings_apiKey_key" ON "MerchantSettings"("apiKey");
CREATE TABLE "new_Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "email" TEXT NOT NULL,
    "ipCountry" TEXT NOT NULL,
    "billingCountry" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "features" JSONB NOT NULL,
    "riskScore" REAL,
    "confidence" REAL,
    "reasons" JSONB,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "policyDecision" TEXT,
    "actionTaken" TEXT,
    "humanOverride" BOOLEAN NOT NULL DEFAULT false,
    "isLabeledFraud" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'synthetic',
    "disputedAt" DATETIME,
    "refundExecuted" BOOLEAN NOT NULL DEFAULT false,
    "refundId" TEXT,
    "refundError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("actionTaken", "amount", "billingCountry", "confidence", "createdAt", "disputedAt", "email", "features", "humanOverride", "id", "ipCountry", "isLabeledFraud", "policyDecision", "reasons", "refundError", "refundExecuted", "refundId", "riskScore", "source", "timestamp", "txnId", "updatedAt", "usedFallback", "merchantId")
SELECT "actionTaken", "amount", "billingCountry", "confidence", "createdAt", "disputedAt", "email", "features", "humanOverride", "id", "ipCountry", "isLabeledFraud", "policyDecision", "reasons", "refundError", "refundExecuted", "refundId", "riskScore", "source", "timestamp", "txnId", "updatedAt", "usedFallback", 'default_merchant' FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_txnId_key" ON "Transaction"("txnId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");
