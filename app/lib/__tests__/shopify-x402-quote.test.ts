// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShopifyX402Quote,
  validateShopifyX402Quote,
} from "../shopify-x402-quote.server";

const dbMock = vi.hoisted(() => ({
  x402Product: {
    findUnique: vi.fn(),
  },
  x402Quote: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../db.server", () => ({
  default: dbMock,
}));

function makeProduct() {
  return {
    shop: "demo.myshopify.com",
    externalId: "shopify-product-1-variant-2",
    shopifyProductId: "gid://shopify/Product/1",
    shopifyVariantId: "gid://shopify/ProductVariant/2",
    name: "50 JPYC product",
    priceJpyc: "55",
    active: true,
  };
}

describe("shopify x402 quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_X402_SHIPPING_FEE_JPYC = "150";
    process.env.SHOPIFY_X402_FREE_SHIPPING_MIN_JPYC = "100";
    dbMock.x402Product.findUnique.mockResolvedValue(makeProduct());
    dbMock.x402Quote.create.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      usedAt: null,
    }));
  });

  it("creates a quote with configured Shopify shipping fee", async () => {
    const quote = await createShopifyX402Quote({
      productSku: "shopify-product-1-variant-2",
      quantity: 1,
      shipping: {
        name: "鈴木 実",
        postalCode: "1000001",
        prefecture: "東京都",
        address1: "千代田1-1",
        phone: "0312345678",
        email: "buyer@example.test",
      },
    });

    expect(quote).toMatchObject({
      productSku: "shopify-product-1-variant-2",
      quantity: 1,
      productSubtotalJpyc: "55",
      shippingFeeJpyc: "150",
      discountJpyc: "0",
      totalJpyc: "205",
      quoteSource: "shopify",
    });
    expect(dbMock.x402Quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productSku: "shopify-product-1-variant-2",
        productSubtotalJpyc: "55",
        shippingFeeJpyc: "150",
        totalJpyc: "205",
      }),
    });
  });

  it("validates quote totals before webhook order creation", async () => {
    const product = makeProduct();
    const storedQuote = {
      quoteId: "uq_test_quote",
      shop: product.shop,
      productSku: product.externalId,
      shopifyProductId: product.shopifyProductId,
      shopifyVariantId: product.shopifyVariantId,
      quantity: 1,
      productSubtotalJpyc: "55",
      shippingFeeJpyc: "150",
      discountJpyc: "0",
      totalJpyc: "205",
      shippingJson: "{}",
      shippingRateId: "shopify_x402_shipping",
      shippingRateLabel: "送料",
      quoteSource: "shopify",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null,
    };
    dbMock.x402Quote.findUnique.mockResolvedValue(storedQuote);

    await expect(
      validateShopifyX402Quote({
        data: {
          quoteId: "uq_test_quote",
          quantity: 1,
          productSubtotalJpyc: "55",
          shippingFeeJpyc: "150",
          totalJpyc: "205",
        },
        productSku: product.externalId,
        x402Product: product,
        amountJpyc: "205",
      }),
    ).resolves.toEqual({ ok: true, quote: storedQuote });

    await expect(
      validateShopifyX402Quote({
        data: { quoteId: "uq_test_quote", totalJpyc: "204" },
        productSku: product.externalId,
        x402Product: product,
        amountJpyc: "205",
      }),
    ).resolves.toEqual({ ok: false, error: "quote_total_mismatch" });
  });
});
