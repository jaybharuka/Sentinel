-- CreateTable
CREATE TABLE "Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txnId_key" ON "Transaction"("txnId");
