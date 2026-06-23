// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * uniple webhook receiver (= uniple → Shopify app)。
 *
 * uniple checkout 完了/期限切れで uniple が本 endpoint に POST。
 * completed は Shopify `orderMarkAsPaid` GraphQL mutation で paid 化し、 expired は
 * local OrderMapping のみ expired 化する (= Shopify order は pending 維持)。
 *
 * - HMAC-SHA256 raw body verify (= ShopSettings.webhookSecret)
 * - session_id 照合 (= OrderMapping.unipleSessionId)
 * - idempotency: processedEventIds で eventId 履歴管理 (= WC plugin と同 pattern)
 * - userErrors / GraphQL error → status=paid_pending + retryCount++ + lastError
 *
 * orderMarkAsPaid は admin GraphQL API + offline session を要する。 本 endpoint は
 * uniple → app webhook で Shopify session を持たないので、 unauthenticated.admin
 * を使って shop の offline session を読み出して GraphQL client を構築する。
 */

import type { ActionFunctionArgs } from "react-router";
import { createHash } from "node:crypto";
import db from "../db.server";
import { UnipleClient } from "../lib/uniple-client.server";
import { unauthenticated } from "../shopify.server";

const ORDER_MARK_AS_PAID_MUTATION = `#graphql
  mutation OrderMarkAsPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order { id displayFinancialStatus }
      userErrors { field message }
    }
  }
`;

const ORDER_CREATE_MUTATION = `#graphql
  mutation X402OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name displayFinancialStatus }
      userErrors { field message }
    }
  }
`;

type UnipleWebhookData = {
  sessionId?: string;
  session_id?: string;
  clientReferenceId?: string;
  client_reference_id?: string;
  merchantOrderId?: string;
  merchant_order_id?: string;
  productSku?: string;
  product_sku?: string;
  itemName?: string;
  item_name?: string;
  amountJpyc?: string | number;
  amount_jpyc?: string | number;
  status?: string;
  txHash?: string;
  tx_hash?: string;
  transactionId?: string;
  transaction_id?: string;
  payer?: string;
  payerAddress?: string;
  payer_address?: string;
  shipping?: Record<string, unknown> | null;
  shippingAddress?: Record<string, unknown> | null;
  shipping_address?: Record<string, unknown> | null;
  delivery?: Record<string, unknown> | null;
  recipient?: Record<string, unknown> | null;
};

type UnipleWebhookPayload = UnipleWebhookData & {
  event?: string;
  eventType?: string;
  eventId?: string;
  event_id?: string;
  type?: string;
  data?: UnipleWebhookData;
  payload?: UnipleWebhookData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("method-not-allowed", { status: 405 });
  }
  const rawBody = await request.text();
  const sigHeader = request.headers.get("X-Uniple-Signature") ?? "";

  let payload: UnipleWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: "invalid_payload" });
  }
  const data = payload.data ?? payload.payload ?? payload;
  const sessionId = String(data.sessionId ?? data.session_id ?? "");
  const eventId = String(payload.eventId ?? payload.event_id ?? "");
  const type = String(payload.type ?? payload.event ?? payload.eventType ?? "");
  const status = String(data.status ?? "");
  const productSku = String(data.productSku ?? data.product_sku ?? "");
  const isCompletedEvent = type === "checkout.session.completed";

  const mapping = sessionId
    ? await db.orderMapping.findUnique({ where: { unipleSessionId: sessionId } })
    : null;

  if (isCompletedEvent && productSku && !mapping) {
    const x402Product = await db.x402Product.findUnique({ where: { externalId: productSku } });
    if (!x402Product) {
      return jsonResponse(404, { error: "product_not_found" });
    }
    const settings = await db.shopSettings.findUnique({ where: { shop: x402Product.shop } });
    if (!settings) {
      return jsonResponse(503, { error: "settings_missing" });
    }
    const client = new UnipleClient({
      apiKey: settings.apiKey,
      webhookSecret: settings.webhookSecret,
      merchantLabel: settings.merchantLabel,
      apiBaseUrl: settings.apiBaseUrl,
      mode: settings.mode as "live" | "test",
    });
    if (!client.verifySignature(rawBody, sigHeader)) {
      return jsonResponse(401, { error: "invalid_signature" });
    }
    return handleX402Completed({
      data,
      eventId,
      productSku,
      rawBody,
      type,
      x402Product,
    });
  }

  if (!sessionId) {
    return jsonResponse(400, { error: "missing_session_id" });
  }

  if (!mapping) {
    return jsonResponse(404, { error: "mapping_not_found" });
  }

  const settings = await db.shopSettings.findUnique({ where: { shop: mapping.shop } });
  if (!settings) {
    return jsonResponse(503, { error: "settings_missing" });
  }
  const client = new UnipleClient({
    apiKey: settings.apiKey,
    webhookSecret: settings.webhookSecret,
    merchantLabel: settings.merchantLabel,
    apiBaseUrl: settings.apiBaseUrl,
    mode: settings.mode as "live" | "test",
  });
  if (!client.verifySignature(rawBody, sigHeader)) {
    return jsonResponse(401, { error: "invalid_signature" });
  }

  // idempotency: eventId 履歴 (= 最大 50 件保持)
  const processedIds: string[] = safeJsonArray(mapping.processedEventIds);
  if (eventId && processedIds.includes(eventId)) {
    return jsonResponse(200, { ok: true, duplicate: true });
  }

  if (type === "checkout.session.expired" || status === "expired") {
    await db.orderMapping.update({
      where: { id: mapping.id },
      data: {
        ...(mapping.status === "pending" ? { status: "expired" } : {}),
        processedEventIds: appendEventId(processedIds, eventId),
      },
    });
    return jsonResponse(200, {
      ok: true,
      expired: mapping.status === "pending",
      status: mapping.status === "pending" ? "expired" : mapping.status,
    });
  }

  if (type !== "checkout.session.completed" || status !== "completed") {
    return jsonResponse(200, { ok: true, ignored: true });
  }
  if (mapping.status === "paid") {
    // 既に paid: eventId 履歴のみ追記
    await db.orderMapping.update({
      where: { id: mapping.id },
      data: { processedEventIds: appendEventId(processedIds, eventId) },
    });
    return jsonResponse(200, { ok: true, already_paid: true });
  }

  const txHash = String(
    data.txHash ??
      data.tx_hash ??
      data.transactionId ??
      data.transaction_id ??
      "",
  );
  const payer = String(
    data.payer ?? data.payerAddress ?? data.payer_address ?? "",
  );

  // Shopify offline session で admin GraphQL client 構築
  try {
    const { admin } = await unauthenticated.admin(mapping.shop);
    const result = await admin.graphql(ORDER_MARK_AS_PAID_MUTATION, {
      variables: { input: { id: mapping.shopifyOrderId } },
    });
    const json = (await result.json()) as {
      data?: { orderMarkAsPaid?: { userErrors?: Array<{ field: string[]; message: string }> } };
    };
    const userErrors = json.data?.orderMarkAsPaid?.userErrors ?? [];
    if (userErrors.length > 0) {
      const message = userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ");
      await db.orderMapping.update({
        where: { id: mapping.id },
        data: {
          status: "paid_pending",
          lastError: message.slice(0, 500),
          retryCount: { increment: 1 },
          txHash: txHash || null,
          payer: payer || null,
          processedEventIds: appendEventId(processedIds, eventId),
        },
      });
      return jsonResponse(200, { ok: true, paid_pending: true, userErrors });
    }

    await db.orderMapping.update({
      where: { id: mapping.id },
      data: {
        status: "paid",
        txHash: txHash || null,
        payer: payer || null,
        processedEventIds: appendEventId(processedIds, eventId),
      },
    });
    return jsonResponse(200, { ok: true });
  } catch (e) {
    const err = e as Error;
    await db.orderMapping.update({
      where: { id: mapping.id },
      data: {
        status: "paid_pending",
        lastError: `mutation_failed: ${err.message}`.slice(0, 500),
        retryCount: { increment: 1 },
        processedEventIds: appendEventId(processedIds, eventId),
      },
    });
    return jsonResponse(500, { error: "mutation_failed", message: err.message });
  }
};

type X402ProductRecord = {
  shop: string;
  externalId: string;
  shopifyVariantId: string;
  name: string;
  priceJpyc: string;
};

async function handleX402Completed({
  data,
  eventId,
  productSku,
  rawBody,
  type,
  x402Product,
}: {
  data: UnipleWebhookData;
  eventId: string;
  productSku: string;
  rawBody: string;
  type: string;
  x402Product: X402ProductRecord;
}): Promise<Response> {
  const amountJpyc = normalizeOrderAmount(data.amountJpyc ?? data.amount_jpyc);
  if (!amountJpyc) {
    return jsonResponse(400, { error: "amount_missing_or_invalid" });
  }

  const sessionId = String(data.sessionId ?? data.session_id ?? "");
  const merchantOrderId = String(data.merchantOrderId ?? data.merchant_order_id ?? "");
  const clientReferenceId = String(data.clientReferenceId ?? data.client_reference_id ?? "");
  let idempotencyRef = sessionId || merchantOrderId || clientReferenceId || hashPayload(rawBody);
  if (idempotencyRef.length > 180) idempotencyRef = hashPayload(idempotencyRef);
  const idempotencyKey = `${type}:${idempotencyRef}`;

  const existing = await db.x402Order.findUnique({ where: { idempotencyKey } });
  if (existing?.status === "created") {
    return jsonResponse(200, {
      ok: true,
      duplicate: true,
      orderId: existing.shopifyOrderId,
      orderName: existing.shopifyOrderName,
    });
  }
  if (existing?.status === "processing") {
    return jsonResponse(202, { ok: true, queued: true });
  }

  try {
    if (existing) {
      await db.x402Order.update({
        where: { idempotencyKey },
        data: {
          status: "processing",
          lastError: null,
          processedEventIds: appendEventId(safeJsonArray(existing.processedEventIds), eventId),
        },
      });
    } else {
      await db.x402Order.create({
        data: {
          shop: x402Product.shop,
          idempotencyKey,
          productSku,
          amountJpyc,
          txHash: readPayloadString(data, ["txHash", "tx_hash", "transactionId", "transaction_id"]) || null,
          payer: readPayloadString(data, ["payer", "payerAddress", "payer_address", "from"]) || null,
          status: "processing",
          processedEventIds: appendEventId([], eventId),
        },
      });
    }
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "P2002") {
      return jsonResponse(202, { ok: true, queued: true });
    }
    throw e;
  }

  const txHash = readPayloadString(data, ["txHash", "tx_hash", "transactionId", "transaction_id"]);
  const payer = readPayloadString(data, ["payer", "payerAddress", "payer_address", "from"]);
  const itemName = readPayloadString(data, ["itemName", "item_name"]) || x402Product.name;
  const address = x402MailingAddress(data, payer);
  const note = x402OrderNote(productSku, merchantOrderId, clientReferenceId, txHash, payer);

  try {
    const { admin } = await unauthenticated.admin(x402Product.shop);
    const result = await admin.graphql(ORDER_CREATE_MUTATION, {
      variables: {
        order: {
          currency: "JPY",
          financialStatus: "PAID",
          email: address.email,
          lineItems: [
            {
              variantId: x402Product.shopifyVariantId,
              quantity: 1,
              priceSet: { shopMoney: { amount: amountJpyc, currencyCode: "JPY" } },
              taxable: false,
            },
          ],
          transactions: [
            {
              kind: "SALE",
              status: "SUCCESS",
              amountSet: { shopMoney: { amount: amountJpyc, currencyCode: "JPY" } },
              gateway: "uniple x402",
            },
          ],
          shippingAddress: address.mailingAddress,
          billingAddress: address.mailingAddress,
          tags: ["uniple", "x402", "JPYC"],
          note,
          customAttributes: [
            { key: "uniple_product_sku", value: productSku },
            { key: "uniple_merchant_order_id", value: merchantOrderId },
            { key: "uniple_client_reference_id", value: clientReferenceId },
            { key: "uniple_item_name", value: itemName },
            { key: "uniple_tx_hash", value: txHash },
          ].filter((attr) => attr.value),
        },
        options: { sendReceipt: false, sendFulfillmentReceipt: false },
      },
    });
    const json = (await result.json()) as {
      data?: {
        orderCreate?: {
          order?: { id?: string; name?: string; displayFinancialStatus?: string };
          userErrors?: Array<{ field?: string[]; message: string }>;
        };
      };
      errors?: unknown;
    };
    const userErrors = json.data?.orderCreate?.userErrors ?? [];
    if (json.errors || userErrors.length > 0 || !json.data?.orderCreate?.order?.id) {
      const message = json.errors
        ? "graphql_errors"
        : userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ");
      await db.x402Order.update({
        where: { idempotencyKey },
        data: { status: "failed", lastError: message.slice(0, 500) },
      });
      return jsonResponse(500, { error: "x402_order_create_failed", userErrors });
    }

    const order = json.data.orderCreate.order;
    await db.x402Order.update({
      where: { idempotencyKey },
      data: {
        status: "created",
        shopifyOrderId: order.id ?? null,
        shopifyOrderName: order.name ?? null,
        txHash: txHash || null,
        payer: payer || null,
        lastError: null,
      },
    });

    return jsonResponse(200, {
      ok: true,
      x402: true,
      orderId: order.id,
      orderName: order.name,
    });
  } catch (e) {
    const message = `mutation_failed: ${(e as Error).message}`;
    await db.x402Order.update({
      where: { idempotencyKey },
      data: { status: "failed", lastError: message.slice(0, 500) },
    });
    return jsonResponse(500, { error: "mutation_failed", message });
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeJsonArray(input: string): string[] {
  try {
    const arr = JSON.parse(input);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function appendEventId(current: string[], eventId: string): string {
  if (!eventId) return JSON.stringify(current);
  if (current.includes(eventId)) return JSON.stringify(current);
  const next = [...current, eventId].slice(-50);
  return JSON.stringify(next);
}

function normalizeOrderAmount(value: unknown): string | null {
  if (value === null || value === undefined || value === false || value === "") return null;
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const integer = match[1].replace(/^0+/, "") || "0";
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (integer === "0" && fraction === "") return null;
  return fraction ? `${integer}.${fraction}` : integer;
}

function hashPayload(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readPayloadString(data: UnipleWebhookData | Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key as keyof typeof data];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
  }
  return "";
}

function x402ShippingPayload(data: UnipleWebhookData): Record<string, unknown> {
  for (const key of ["shipping", "shippingAddress", "shipping_address", "delivery", "recipient"] as const) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function x402MailingAddress(data: UnipleWebhookData, payer: string): {
  email: string;
  mailingAddress: Record<string, string>;
} {
  const shipping = x402ShippingPayload(data);
  const [fallbackLastName, fallbackFirstName] = x402BuyerName(data, payer);
  let firstName = readPayloadString(shipping, ["firstName", "first_name", "givenName", "given_name", "name02"]);
  let lastName = readPayloadString(shipping, ["lastName", "last_name", "familyName", "family_name", "name01"]);
  const fullName = readPayloadString(shipping, [
    "name",
    "fullName",
    "full_name",
    "recipientName",
    "recipient_name",
    "shippingName",
    "shipping_name",
  ]);
  if ((!firstName || !lastName) && fullName) {
    const parts = fullName.split(/\s+/u, 2);
    if (!lastName) lastName = parts[0] ?? "";
    if (!firstName) firstName = parts[1] ?? "";
  }
  if (!lastName) lastName = fallbackLastName;
  if (!firstName) firstName = fallbackFirstName;

  const city = readPayloadString(shipping, ["city", "municipality", "ward"]);
  const address1 = readPayloadString(shipping, [
    "addr01",
    "address1",
    "address_1",
    "addressLine1",
    "address_line1",
    "line1",
    "streetAddress",
    "street_address",
  ]);
  const address2 = readPayloadString(shipping, [
    "addr02",
    "address2",
    "address_2",
    "addressLine2",
    "address_line2",
    "line2",
    "building",
    "apartment",
    "room",
  ]);
  const phone = readPayloadString(shipping, ["phoneNumber", "phone_number", "phone", "tel", "telephone"]);
  const zip = readPayloadString(shipping, [
    "postalCode",
    "postal_code",
    "postCode",
    "post_code",
    "zipCode",
    "zip_code",
    "zipcode",
    "zip",
  ]);
  const email =
    readPayloadString(shipping, ["email", "mail"]) ||
    readPayloadString(data, ["email", "buyerEmail", "buyer_email", "payerEmail", "payer_email"]) ||
    "x402-agent@uniple.local";

  return {
    email: truncate(email, 255),
    mailingAddress: {
      firstName: truncate(firstName, 255),
      lastName: truncate(lastName, 255),
      address1: truncate(`${city} ${address1}`.trim() || "x402", 255),
      address2: truncate(address2 || "AI purchase", 255),
      city: truncate(city || "x402", 255),
      zip: truncate(zip || "0000000", 32),
      countryCode: "JP",
      phone: truncate(phone || "0000000000", 32),
    },
  };
}

function x402BuyerName(data: UnipleWebhookData, payer: string): [string, string] {
  let raw = readPayloadString(data, ["buyerName", "buyer_name", "name"]);
  if (!raw && payer) raw = `x402 ${payer.slice(0, 12)}`;
  if (!raw) return ["x402", "Buyer"];
  const parts = raw.split(/\s+/u, 2);
  return [truncate(parts[0] || "x402", 255), truncate(parts[1] || "Buyer", 255)];
}

function x402OrderNote(
  productSku: string,
  merchantOrderId: string,
  clientReferenceId: string,
  txHash: string,
  payer: string,
): string {
  const lines = ["uniple x402 purchase", `productSku: ${productSku}`];
  if (merchantOrderId) lines.push(`merchantOrderId: ${merchantOrderId}`);
  if (clientReferenceId) lines.push(`clientReferenceId: ${clientReferenceId}`);
  if (txHash) lines.push(`txHash: ${txHash}`);
  if (payer) lines.push(`payer: ${payer}`);
  return truncate(lines.join("\n"), 4000);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
