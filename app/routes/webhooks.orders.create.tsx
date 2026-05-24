/**
 * Shopify orders/create webhook handler.
 *
 * shop で order が作成されると Shopify から本 endpoint に POST、 plugin が
 * uniple session を発行 + Shopify order metafield に session_id 紐付け。
 *
 * Manual Payment + Thank you pay link flow (= codex Path A):
 *   1. shop で order 作成 (= status: pending、 financial_status: pending)
 *   2. 本 webhook で uniple session 発行 + order metafield に紐付け
 *   3. Thank you / Order status UI extension が metafield から checkoutUrl 読取り、
 *      pay button 表示
 *   4. 購入者 click → uniple checkout → MetaMask 送金 → uniple webhook で paid
 *
 * idempotency: 既に OrderMapping ある場合は session 再発行せず skip。
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { UnipleClient } from "../lib/uniple-client.server";
import { extractOrderNumericId, normalizeOrderGid } from "../lib/shopify-gid.server";
import { toIntegerJpyc } from "../lib/uniple-amount.server";
import { setUnipleOrderMetafields } from "../lib/shopify-metafields.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("ignored", { status: 200 });
  }

  const order = payload as {
    id?: number | string;
    admin_graphql_api_id?: string;
    name?: string;
    currency?: string;
    total_price?: string;
    financial_status?: string;
    line_items?: Array<{ title?: string }>;
  };

  // financial_status が paid 等の場合は uniple session 発行不要 (= 別 gateway 利用)
  if (order.financial_status && order.financial_status !== "pending") {
    return new Response("non-pending-skip", { status: 200 });
  }

  // currency = JPY のみ対応 (= uniple は JPYC 整数前提)
  if (order.currency && order.currency !== "JPY") {
    return new Response("currency-not-jpy-skip", { status: 200 });
  }

  const gidRaw = order.admin_graphql_api_id ?? (order.id ? String(order.id) : "");
  if (!gidRaw) {
    return new Response("missing-order-id", { status: 200 });
  }
  const orderGid = normalizeOrderGid(gidRaw);
  const numericId = extractOrderNumericId(orderGid);

  // idempotency: 既存 mapping なら early return
  const existing = await db.orderMapping.findUnique({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderGid } },
  });
  if (existing) {
    return new Response("duplicate-order-skip", { status: 200 });
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings || !settings.apiKey) {
    return new Response("settings-missing", { status: 200 });
  }

  let amountJpyc: number;
  try {
    amountJpyc = toIntegerJpyc(order.total_price ?? "");
  } catch {
    return new Response("invalid-amount", { status: 200 });
  }

  const itemName =
    order.line_items?.[0]?.title ?? `Shopify order ${order.name ?? `#${numericId}`}`;

  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  const successUrl = `${appUrl}/api/uniple-return?shop=${encodeURIComponent(shop)}&order=${encodeURIComponent(numericId)}`;
  const cancelUrl = `https://${shop}/account/orders/${numericId}`;
  const webhookUrl = `${appUrl}/webhooks/uniple`;

  const client = new UnipleClient({
    apiKey: settings.apiKey,
    webhookSecret: settings.webhookSecret,
    merchantLabel: settings.merchantLabel,
    apiBaseUrl: settings.apiBaseUrl,
    mode: settings.mode as "live" | "test",
  });

  try {
    const session = await client.createSession({
      amountJpyc,
      merchantOrderId: numericId,
      itemName,
      successUrl,
      cancelUrl,
      webhookUrl,
    });

    try {
      await db.orderMapping.create({
        data: {
          shop,
          shopifyOrderId: orderGid,
          shopifyOrderNumericId: numericId,
          unipleSessionId: session.sessionId,
          unipleEnv: settings.mode,
          amountJpyc,
          currency: "JPY",
          status: "pending",
        },
      });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "P2002") {
        return new Response("duplicate-retry-skip", { status: 200 });
      }
      throw e;
    }

    // Shopify order に uniple metafield 書込 (= UI extension の pay button 依存先)
    // 失敗しても mapping は作成済 (= 後段で metafield を補完できる)、 log warning で 200 return
    try {
      await setUnipleOrderMetafields(shop, orderGid, {
        checkoutUrl: session.checkoutUrl,
        sessionId: session.sessionId,
        status: "pending",
      });
    } catch (e) {
      const err = e as Error;
      console.warn("[uniple] setUnipleOrderMetafields failed", err.message);
      await db.orderMapping.updateMany({
        where: { unipleSessionId: session.sessionId },
        data: { lastError: `metafield_write_failed: ${err.message}`.slice(0, 500) },
      });
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    const err = e as Error;
    console.error("[uniple] createSession failed", err);
    // Shopify webhook retry を回避するため 200 return (= mapping 作成失敗 = 再投入で
    // 自己回復不能)、 lastError は mapping ない段階で記録できないので log のみ。
    // codex r70 caveat: 内部 retry / 失敗記録の必要あり = 0.2.0 で merchant dashboard に
    // 失敗 order list 表示 + retry button 追加検討。
    return new Response("createSession-failed: " + err.message, { status: 200 });
  }
};
