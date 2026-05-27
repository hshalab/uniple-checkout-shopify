/**
 * uniple return URL handler (= `/api/uniple-return?shop=...&order=...`)。
 *
 * uniple checkout 完了で uniple SSR が本 endpoint に redirect、 buyer は最終的に
 * Shopify shop の order status page に遷移する。 ここで option C fallback を実行
 * (= WP / EC-CUBE 4 plugin と同 pattern):
 *   - mapping が pending かつ session_id 既知 → uniple GET sessions で live lookup
 *   - status=completed なら paid 確定 (= orderMarkAsPaid + processedEventIds 更新)
 *   - webhook 未着 / 遅延時の last-line defense
 *
 * 最後に Shopify order status page へ redirect、 buyer は注文確認画面を見る。
 */

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
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

const SHOP_ID_QUERY = `#graphql
  query ShopIdForCustomerAccountUrl {
    shop {
      id
    }
  }
`;

function numericIdFromGid(gid: string | undefined | null): string | null {
  const match = gid?.match(/\/(\d+)$/);
  return match?.[1] ?? null;
}

async function buildCustomerAccountOrderUrl(shop: string, orderNumericId: string): Promise<string> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(SHOP_ID_QUERY);
    const json = (await res.json()) as { data?: { shop?: { id?: string } } };
    const shopNumericId = numericIdFromGid(json.data?.shop?.id);
    if (shopNumericId) {
      return `https://shopify.com/${shopNumericId}/account/orders/${encodeURIComponent(orderNumericId)}`;
    }
  } catch (e) {
    console.warn("[uniple] shop id lookup failed:", (e as Error).message);
  }

  return `https://${shop}/account/orders/${encodeURIComponent(orderNumericId)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") ?? "").trim();
  const orderNumericId = (url.searchParams.get("order") ?? "").trim();

  if (!shop || !orderNumericId) {
    return redirect("https://uniple.io/");
  }

  const mapping = await db.orderMapping.findFirst({
    where: { shop, shopifyOrderNumericId: orderNumericId },
  });

  // mapping 不在 = 不正アクセス or expired、 shop top に逃がす
  if (!mapping) {
    return redirect(`https://${shop}/`);
  }

  if (mapping.status === "pending" && mapping.unipleSessionId) {
    const settings = await db.shopSettings.findUnique({ where: { shop } });
    if (settings) {
      const client = new UnipleClient({
        apiKey: settings.apiKey,
        webhookSecret: settings.webhookSecret,
        merchantLabel: settings.merchantLabel,
        apiBaseUrl: settings.apiBaseUrl,
        mode: settings.mode as "live" | "test",
      });
      try {
        const live = await client.getCheckoutSession(mapping.unipleSessionId);
        const liveStatus = live.item?.status ?? "";
        if (liveStatus === "completed") {
          const txHash = String(live.item?.txHash ?? live.item?.transactionId ?? "");
          const payer = String(live.item?.payer ?? "");
          // GraphQL admin で paid 化を試行
          try {
            const { admin } = await unauthenticated.admin(shop);
            const res = await admin.graphql(ORDER_MARK_AS_PAID_MUTATION, {
              variables: { input: { id: mapping.shopifyOrderId } },
            });
            const json = (await res.json()) as {
              data?: { orderMarkAsPaid?: { userErrors?: Array<{ field: string[]; message: string }> } };
            };
            const userErrors = json.data?.orderMarkAsPaid?.userErrors ?? [];
            if (userErrors.length === 0) {
              await db.orderMapping.update({
                where: { id: mapping.id },
                data: { status: "paid", txHash: txHash || null, payer: payer || null },
              });
            } else {
              const message = userErrors
                .map((e) => `${(e.field ?? []).join(".")}: ${e.message}`)
                .join("; ");
              await db.orderMapping.update({
                where: { id: mapping.id },
                data: {
                  status: "paid_pending",
                  lastError: message.slice(0, 500),
                  retryCount: { increment: 1 },
                  txHash: txHash || null,
                  payer: payer || null,
                },
              });
            }
          } catch (e) {
            const err = e as Error;
            await db.orderMapping.update({
              where: { id: mapping.id },
              data: {
                status: "paid_pending",
                lastError: `option_c_mutation_failed: ${err.message}`.slice(0, 500),
                retryCount: { increment: 1 },
                txHash: txHash || null,
                payer: payer || null,
              },
            });
          }
        }
      } catch (e) {
        // option C live lookup 失敗 = 静かに無視 (= webhook を待つ)
        console.warn("[uniple] option C lookup failed:", (e as Error).message);
      }
    }
  }

  // 最終遷移先 = Shopify Order の statusPageUrl (= signed token 含む、 customer login 不要)。
  // codex 査読 r80: `/account/orders/<id>` は customer account login を要求する path のため
  // WP plugin の `get_checkout_order_received_url()` 相当として Admin GraphQL の
  // `Order.statusPageUrl` を採用。 不在 (= permission / network error) なら Customer Account
  // の order detail URL に fallback し、 shop TOP には落とさない。
  let statusUrl: string | null = null;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      query StatusPageUrl($id: ID!) {
        order(id: $id) {
          statusPageUrl
        }
      }`,
      { variables: { id: mapping.shopifyOrderId } },
    );
    const json = (await res.json()) as { data?: { order?: { statusPageUrl?: string } } };
    statusUrl = json.data?.order?.statusPageUrl ?? null;
  } catch (e) {
    console.warn("[uniple] statusPageUrl lookup failed:", (e as Error).message);
  }

  return redirect(statusUrl ?? (await buildCustomerAccountOrderUrl(shop, orderNumericId)));
};
