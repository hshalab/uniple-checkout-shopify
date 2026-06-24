-- x402 shipping quote reservation for Shopify app.
CREATE TABLE "X402Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "productSubtotalJpyc" TEXT NOT NULL,
    "shippingFeeJpyc" TEXT NOT NULL,
    "discountJpyc" TEXT NOT NULL DEFAULT '0',
    "totalJpyc" TEXT NOT NULL,
    "shippingJson" TEXT NOT NULL,
    "shippingRateId" TEXT,
    "shippingRateLabel" TEXT,
    "quoteSource" TEXT NOT NULL DEFAULT 'shopify',
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "X402Quote_quoteId_key" ON "X402Quote"("quoteId");
CREATE INDEX "X402Quote_shop_idx" ON "X402Quote"("shop");
CREATE INDEX "X402Quote_productSku_idx" ON "X402Quote"("productSku");
CREATE INDEX "X402Quote_expiresAt_idx" ON "X402Quote"("expiresAt");
