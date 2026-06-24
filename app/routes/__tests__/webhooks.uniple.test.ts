// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../webhooks.uniple";

const dbMock = vi.hoisted(() => ({
  orderMapping: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  x402Product: {
    findUnique: vi.fn(),
  },
  x402Order: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  x402Quote: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shopSettings: {
    findUnique: vi.fn(),
  },
}));

const adminGraphqlMock = vi.hoisted(() => vi.fn());
const unauthenticatedAdminMock = vi.hoisted(() => vi.fn());

vi.mock("../../db.server", () => ({
  default: dbMock,
}));

vi.mock("../../shopify.server", () => ({
  unauthenticated: {
    admin: unauthenticatedAdminMock,
  },
}));

const WEBHOOK_SECRET = "whsec_test";

function sign(rawBody: string): string {
  return (
    "sha256=" +
    createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")
  );
}

function makeRequest(payload: Record<string, unknown>): Request {
  const body = JSON.stringify(payload);
  return new Request("https://example.test/webhooks/uniple", {
    method: "POST",
    headers: { "X-Uniple-Signature": sign(body) },
    body,
  });
}

function makeMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: "map_1",
    shop: "demo.myshopify.com",
    shopifyOrderId: "gid://shopify/Order/7207249445032",
    unipleSessionId: "ucs_expired",
    status: "pending",
    processedEventIds: "[]",
    ...overrides,
  };
}

function makeSettings() {
  return {
    apiKey: "ums_test",
    webhookSecret: WEBHOOK_SECRET,
    merchantLabel: "demo",
    apiBaseUrl: "https://dev.uniple.io",
    mode: "test",
  };
}

function makeX402Product() {
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

function makeX402Quote(overrides: Record<string, unknown> = {}) {
  return {
    quoteId: "uq_test_quote",
    shop: "demo.myshopify.com",
    productSku: "shopify-product-1-variant-2",
    shopifyProductId: "gid://shopify/Product/1",
    shopifyVariantId: "gid://shopify/ProductVariant/2",
    quantity: 1,
    productSubtotalJpyc: "55",
    shippingFeeJpyc: "150",
    discountJpyc: "0",
    totalJpyc: "205",
    shippingJson: JSON.stringify({
      name: "鈴木 実",
      firstName: "実",
      lastName: "鈴木",
      email: "buyer@example.test",
      phone: "0312345678",
      postalCode: "1000001",
      prefecture: "東京都",
      provinceCode: "JP-13",
      city: "千代田区",
      address1: "千代田区 千代田1-1",
      address2: "テストビル101",
      country: "JP",
    }),
    shippingRateId: "shopify_x402_shipping",
    shippingRateLabel: "送料",
    quoteSource: "shopify",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    usedAt: null,
    ...overrides,
  };
}

describe("webhooks.uniple action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.shopSettings.findUnique.mockResolvedValue(makeSettings());
    dbMock.x402Product.findUnique.mockResolvedValue(null);
    dbMock.x402Order.findUnique.mockResolvedValue(null);
    dbMock.x402Order.create.mockResolvedValue({});
    dbMock.x402Order.update.mockResolvedValue({});
    dbMock.x402Quote.findUnique.mockResolvedValue(null);
    dbMock.x402Quote.update.mockResolvedValue({});
  });

  it("marks a pending mapping expired and returns 200 without touching Shopify", async () => {
    dbMock.orderMapping.findUnique.mockResolvedValue(makeMapping());
    dbMock.orderMapping.update.mockResolvedValue(
      makeMapping({ status: "expired" }),
    );

    const response = await action({
      request: makeRequest({
        event_id: "evt_expired_1",
        event: "checkout.session.expired",
        session_id: "ucs_expired",
        status: "expired",
      }),
    } as never);

    await expect(response.json()).resolves.toEqual({
      ok: true,
      expired: true,
      status: "expired",
    });
    expect(response.status).toBe(200);
    expect(dbMock.orderMapping.update).toHaveBeenCalledWith({
      where: { id: "map_1" },
      data: {
        status: "expired",
        processedEventIds: JSON.stringify(["evt_expired_1"]),
      },
    });
    expect(unauthenticatedAdminMock).not.toHaveBeenCalled();
  });

  it("records expired event ids without downgrading non-pending mappings", async () => {
    dbMock.orderMapping.findUnique.mockResolvedValue(
      makeMapping({ status: "paid" }),
    );
    dbMock.orderMapping.update.mockResolvedValue(
      makeMapping({ status: "paid" }),
    );

    const response = await action({
      request: makeRequest({
        eventId: "evt_expired_paid",
        type: "checkout.session.expired",
        data: {
          sessionId: "ucs_expired",
          status: "expired",
        },
      }),
    } as never);

    await expect(response.json()).resolves.toEqual({
      ok: true,
      expired: false,
      status: "paid",
    });
    expect(response.status).toBe(200);
    expect(dbMock.orderMapping.update).toHaveBeenCalledWith({
      where: { id: "map_1" },
      data: {
        processedEventIds: JSON.stringify(["evt_expired_paid"]),
      },
    });
    expect(unauthenticatedAdminMock).not.toHaveBeenCalled();
  });

  it("updates paid mapping after orderMarkAsPaid succeeds", async () => {
    dbMock.orderMapping.findUnique.mockResolvedValue(makeMapping());
    dbMock.orderMapping.update.mockResolvedValue(
      makeMapping({ status: "paid" }),
    );
    unauthenticatedAdminMock.mockResolvedValue({
      admin: { graphql: adminGraphqlMock },
    });
    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: { orderMarkAsPaid: { userErrors: [] } },
      }),
    });

    const response = await action({
      request: makeRequest({
        eventId: "evt_completed_1",
        type: "checkout.session.completed",
        data: {
          sessionId: "ucs_expired",
          status: "completed",
          txHash: "0xabc",
          payer: "0xpayer",
        },
      }),
    } as never);

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(dbMock.orderMapping.update).toHaveBeenCalledWith({
      where: { id: "map_1" },
      data: {
        status: "paid",
        txHash: "0xabc",
        payer: "0xpayer",
        processedEventIds: JSON.stringify(["evt_completed_1"]),
      },
    });
  });

  it("creates a Shopify x402 order from a validated shipping quote", async () => {
    dbMock.orderMapping.findUnique.mockResolvedValue(null);
    dbMock.x402Product.findUnique.mockResolvedValue(makeX402Product());
    dbMock.x402Quote.findUnique.mockResolvedValue(makeX402Quote());
    unauthenticatedAdminMock.mockResolvedValue({
      admin: { graphql: adminGraphqlMock },
    });
    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          orderCreate: {
            userErrors: [],
            order: { id: "gid://shopify/Order/100", name: "#100" },
          },
        },
      }),
    });

    const response = await action({
      request: makeRequest({
        eventId: "evt_x402_quote",
        type: "checkout.session.completed",
        data: {
          productSku: "shopify-product-1-variant-2",
          quoteId: "uq_test_quote",
          quantity: 1,
          amountJpyc: "205",
          productSubtotalJpyc: "55",
          shippingFeeJpyc: "150",
          totalJpyc: "205",
          merchantOrderId: "x402-shopify-quote-test",
          txHash: "0xabc",
          payer: "0xpayer",
        },
      }),
    } as never);

    await expect(response.json()).resolves.toEqual({
      ok: true,
      x402: true,
      orderId: "gid://shopify/Order/100",
      orderName: "#100",
    });
    expect(response.status).toBe(200);
    expect(adminGraphqlMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        variables: expect.objectContaining({
          order: expect.objectContaining({
            email: "buyer@example.test",
            lineItems: [
              expect.objectContaining({
                variantId: "gid://shopify/ProductVariant/2",
                quantity: 1,
                priceSet: { shopMoney: { amount: "55", currencyCode: "JPY" } },
              }),
              expect.objectContaining({
                title: "送料",
                quantity: 1,
                priceSet: { shopMoney: { amount: "150", currencyCode: "JPY" } },
              }),
            ],
            transactions: [
              expect.objectContaining({
                amountSet: { shopMoney: { amount: "205", currencyCode: "JPY" } },
              }),
            ],
            customAttributes: expect.arrayContaining([
              { key: "uniple_quote_id", value: "uq_test_quote" },
              { key: "uniple_product_subtotal_jpyc", value: "55" },
              { key: "uniple_shipping_fee_jpyc", value: "150" },
              { key: "uniple_total_jpyc", value: "205" },
            ]),
          }),
        }),
      }),
    );
    expect(dbMock.x402Quote.update).toHaveBeenCalledWith({
      where: { quoteId: "uq_test_quote" },
      data: { usedAt: expect.any(Date) },
    });
  });
});
