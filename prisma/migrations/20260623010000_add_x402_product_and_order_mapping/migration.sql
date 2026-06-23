-- x402 product catalog local mapping and webhook idempotency for Shopify app.
CREATE TABLE "X402Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceJpyc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "X402Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "amountJpyc" TEXT NOT NULL,
    "txHash" TEXT,
    "payer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "lastError" TEXT,
    "processedEventIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "X402Product_externalId_key" ON "X402Product"("externalId");
CREATE INDEX "X402Product_shop_idx" ON "X402Product"("shop");
CREATE UNIQUE INDEX "X402Order_idempotencyKey_key" ON "X402Order"("idempotencyKey");
CREATE INDEX "X402Order_shop_idx" ON "X402Order"("shop");
CREATE INDEX "X402Order_status_idx" ON "X402Order"("status");
