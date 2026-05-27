import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../webhooks.uniple";

const dbMock = vi.hoisted(() => ({
  orderMapping: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shopSettings: {
    findUnique: vi.fn(),
  },
}));

const adminGraphqlMock = vi.hoisted(() => vi.fn());
const unauthenticatedAdminMock = vi.hoisted(() => vi.fn());
const setUnipleOrderMetafieldsMock = vi.hoisted(() => vi.fn());

vi.mock("../../db.server", () => ({
  default: dbMock,
}));

vi.mock("../../shopify.server", () => ({
  unauthenticated: {
    admin: unauthenticatedAdminMock,
  },
}));

vi.mock("../../lib/shopify-metafields.server", () => ({
  setUnipleOrderMetafields: setUnipleOrderMetafieldsMock,
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

describe("webhooks.uniple action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.shopSettings.findUnique.mockResolvedValue(makeSettings());
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
    expect(setUnipleOrderMetafieldsMock).not.toHaveBeenCalled();
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

  it("updates paid mapping and metafields after orderMarkAsPaid succeeds", async () => {
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
    expect(setUnipleOrderMetafieldsMock).toHaveBeenCalledWith(
      "demo.myshopify.com",
      "gid://shopify/Order/7207249445032",
      { status: "paid" },
      { graphql: adminGraphqlMock },
    );
  });
});
