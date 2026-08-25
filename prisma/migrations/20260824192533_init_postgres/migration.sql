-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "merchantId" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "email" TEXT NOT NULL,
    "ipCountry" TEXT NOT NULL,
    "billingCountry" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "features" JSONB NOT NULL,
    "riskScore" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "reasons" JSONB,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "policyDecision" TEXT,
    "actionTaken" TEXT,
    "humanOverride" BOOLEAN NOT NULL DEFAULT false,
    "isLabeledFraud" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'synthetic',
    "disputedAt" TIMESTAMP(3),
    "refundExecuted" BOOLEAN,
    "refundId" TEXT,
    "refundError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" SERIAL NOT NULL,
    "merchantId" TEXT NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "sentTo" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSettings" (
    "id" SERIAL NOT NULL,
    "merchantId" TEXT NOT NULL,
    "autoRefundMaxAmount" INTEGER NOT NULL DEFAULT 2000,
    "dailyRefundCap" INTEGER NOT NULL DEFAULT 10000,
    "autoRefundMinRiskScore" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "autoRefundMinConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "holdForReviewMinRiskScore" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "alertEmail" TEXT,
    "apiKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txnId_key" ON "Transaction"("txnId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_merchantId_key" ON "MerchantSettings"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_apiKey_key" ON "MerchantSettings"("apiKey");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSettings" ADD CONSTRAINT "MerchantSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

