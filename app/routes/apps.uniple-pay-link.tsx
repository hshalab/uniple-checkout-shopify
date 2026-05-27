/**
 * App Proxy endpoint = `/apps/uniple-pay-link?orderId=<gid>` (= `<shop>.myshopify.com/apps/uniple-pay-link/...`)
 *
 * codex r82 ADJUST (= 2026-05-14 web search 査読): Path A 維持、 ただし
 * Thank you Block を単一障害点にせず、 lazy-create + multi-channel 提示。
 *
 * 動作 mode:
 *   - default (= browser / email link 経由 click): 302 redirect で uniple checkout URL に飛ばす
 *   - `?json=1` (= UI extension Block fetch 経由): JSON `{status, checkoutUrl}` を返す
 *
 * lazy create = OrderMapping 未着の場合 (= orders/create webhook 競合 で
 * Thank you Block render が先行する case)、 endpoint が Admin API で order 詳細を
 * fetch + uniple session 発行 + DB write + metafield 書込を **その場で実行**。
 *
 * Shopify App Proxy が HMAC `signature` を付加するので SHOPIFY_API_SECRET で検証。
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import crypto from "node:crypto";
import db from "../db.server";
import { UnipleClient } from "../lib/uniple-client.server";
import { extractOrderNumericId, normalizeOrderGid } from "../lib/shopify-gid.server";
import { toIntegerJpyc } from "../lib/uniple-amount.server";
import { buildUnipleCheckoutUrl } from "../lib/uniple-checkout-url.server";
import { setUnipleOrderMetafields } from "../lib/shopify-metafields.server";
import { unauthenticated } from "../shopify.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return new Response("method-not-allowed", { status: 405, headers: CORS_HEADERS });
};

function verifyAppProxySignature(url: URL): boolean {
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  if (!secret) return false;
  const params = new URLSearchParams(url.search);
  const signature = params.get("signature");
  if (!signature) return false;
  params.delete("signature");
  const sorted = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("");
  const computed = crypto
    .createHmac("sha256", secret)
    .update(sorted)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(computed, "utf8"),
  );
}

const ORDER_QUERY = `#graphql
  query OrderForLazyCreate($id: ID!) {
    order(id: $id) {
      id
      name
      currencyCode
      displayFinancialStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 1) { edges { node { title } } }
    }
  }
`;

async function lazyCreateMapping(shop: string, orderGid: string) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings || !settings.apiKey) {
    return { error: "settings-missing" as const };
  }

  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(ORDER_QUERY, { variables: { id: orderGid } });
  const json = (await res.json()) as {
    data?: {
      order?: {
        name?: string;
        currencyCode?: string;
        displayFinancialStatus?: string;
        totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
        lineItems?: { edges?: Array<{ node?: { title?: string } }> };
      };
    };
  };
  const order = json.data?.order;
  if (!order) return { error: "order-not-found" as const };

  // Manual Payment pending のみ対応 = paid 等は skip
  if (order.displayFinancialStatus && order.displayFinancialStatus !== "PENDING") {
    return { error: "non-pending" as const };
  }
  const ccy = order.totalPriceSet?.shopMoney?.currencyCode ?? order.currencyCode ?? "JPY";
  if (ccy !== "JPY") return { error: "currency-not-jpy" as const };

  let amountJpyc: number;
  try {
    amountJpyc = toIntegerJpyc(order.totalPriceSet?.shopMoney?.amount ?? "");
  } catch {
    return { error: "invalid-amount" as const };
  }

  const numericId = extractOrderNumericId(orderGid);
  const itemName = order.lineItems?.edges?.[0]?.node?.title ?? `Shopify order ${order.name ?? `#${numericId}`}`;
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

  let session;
  try {
    session = await client.createSession({
      amountJpyc,
      merchantOrderId: numericId,
      itemName,
      successUrl,
      cancelUrl,
      webhookUrl,
    });
  } catch (e) {
    return { error: `createSession-failed: ${(e as Error).message}` as const };
  }

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
    // P2002 race = orders/create webhook が直前に create 完了。 既存読み直し。
    const ex = e as { code?: string };
    if (ex.code !== "P2002") {
      return { error: `mapping-create-failed: ${(e as Error).message}` as const };
    }
  }

  // metafield 書込 (= 失敗しても decisive ではない)
  try {
    await setUnipleOrderMetafields(shop, orderGid, {
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
      status: "pending",
    });
  } catch (e) {
    console.warn("[uniple] lazy setUnipleOrderMetafields failed", (e as Error).message);
  }

  return {
    ok: true as const,
    status: "pending" as const,
    checkoutUrl: session.checkoutUrl,
    sessionId: session.sessionId,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (!verifyAppProxySignature(url)) {
    return Response.json({ error: "invalid-signature" }, { status: 401, headers: CORS_HEADERS });
  }

  const shop = (url.searchParams.get("shop") ?? "").trim();
  const orderIdRaw = (url.searchParams.get("orderId") ?? url.searchParams.get("order") ?? "").trim();
  const wantsJson = url.searchParams.has("json");

  if (!shop || !orderIdRaw) {
    return Response.json({ error: "missing-params" }, { status: 400, headers: CORS_HEADERS });
  }

  let orderGid: string;
  try {
    orderGid = normalizeOrderGid(orderIdRaw);
  } catch {
    return Response.json({ error: "bad-order-id" }, { status: 400, headers: CORS_HEADERS });
  }

  // 1. 既存 OrderMapping 優先
  let mapping = await db.orderMapping.findUnique({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderGid } },
  });

  // 2. 未着なら lazy create
  let lazyError: string | undefined;
  if (!mapping) {
    const lazy = await lazyCreateMapping(shop, orderGid);
    if ("error" in lazy) {
      lazyError = lazy.error;
    } else {
      mapping = await db.orderMapping.findUnique({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderGid } },
      });
    }
  }

  if (!mapping) {
    if (wantsJson) {
      return Response.json(
        { status: "not-found", error: lazyError ?? "no-mapping" },
        { status: 200, headers: CORS_HEADERS },
      );
    }
    // browser click flow: 失敗ページに飛ばす
    return Response.redirect(`https://${shop}/account/orders/${extractOrderNumericId(orderGid)}`, 302);
  }

  const settings = await db.shopSettings.findUnique({
    where: { shop },
    select: { apiBaseUrl: true },
  });
  const checkoutUrl = buildUnipleCheckoutUrl(settings?.apiBaseUrl, mapping.unipleSessionId);

  if (wantsJson) {
    return Response.json(
      { status: mapping.status, checkoutUrl, sessionId: mapping.unipleSessionId },
      { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
    );
  }

  // 既に paid なら order status page に
  if (mapping.status === "paid") {
    return Response.redirect(`https://${shop}/account/orders/${mapping.shopifyOrderNumericId}`, 302);
  }

  // browser click flow = uniple checkout 画面に直行
  return Response.redirect(checkoutUrl, 302);
};
