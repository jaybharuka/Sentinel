-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "refundExecuted" BOOLEAN,
    "refundId" TEXT,
    "refundError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("actionTaken", "amount", "billingCountry", "confidence", "createdAt", "disputedAt", "email", "features", "humanOverride", "id", "ipCountry", "isLabeledFraud", "merchantId", "policyDecision", "reasons", "refundError", "refundExecuted", "refundId", "riskScore", "source", "timestamp", "txnId", "updatedAt", "usedFallback") SELECT "actionTaken", "amount", "billingCountry", "confidence", "createdAt", "disputedAt", "email", "features", "humanOverride", "id", "ipCountry", "isLabeledFraud", "merchantId", "policyDecision", "reasons", "refundError", "refundExecuted", "refundId", "riskScore", "source", "timestamp", "txnId", "updatedAt", "usedFallback" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_txnId_key" ON "Transaction"("txnId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
