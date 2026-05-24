-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "apiBaseUrl" TEXT NOT NULL DEFAULT 'https://uniple.io',
    "apiKey" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "merchantLabel" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderNumericId" TEXT NOT NULL,
    "unipleSessionId" TEXT NOT NULL,
    "unipleEnv" TEXT NOT NULL DEFAULT 'live',
    "amountJpyc" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "txHash" TEXT,
    "payer" TEXT,
    "lastError" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "processedEventIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMapping_unipleSessionId_key" ON "OrderMapping"("unipleSessionId");

-- CreateIndex
CREATE INDEX "OrderMapping_shop_idx" ON "OrderMapping"("shop");

-- CreateIndex
CREATE INDEX "OrderMapping_status_idx" ON "OrderMapping"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMapping_shop_shopifyOrderId_key" ON "OrderMapping"("shop", "shopifyOrderId");
