/**
 * Customer Account / Order status page block (= customer-account.order-status.block.render)。
 *
 * codex r82 ADJUST (= 2026-05-15 web search 査読): order が常に available なので
 * lazy-create endpoint が確実に動く。 Thank you Block の timing 競合を避け、
 * **本 Block を primary entry** にする。
 *
 * 動作:
 *   1. shopify.order.value.id から GID 取得
 *   2. /apps/uniple-pay-link?orderId=<gid>&json=1 を fetch
 *   3. status=pending なら button "uniple checkout (JPYC) で支払う" を表示
 *   4. status=paid なら success banner
 *
 * 実装 = @shopify/ui-extensions 2026-04 preact base + Polaris web components。
 */

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

declare const shopify: {
  order?: { value?: { id?: string } } | { id?: string };
  orderConfirmation?: { value?: { order?: { id?: string } } };
  shop?: { myshopifyDomain?: string } | { value?: { myshopifyDomain?: string } };
};

interface PayLinkData {
  status?: string;
  checkoutUrl?: string;
  error?: string;
}

function readOrderId(): string {
  const o = shopify.order as { value?: { id?: string }; id?: string } | undefined;
  if (!o) return shopify.orderConfirmation?.value?.order?.id ?? "";
  if (typeof o.id === "string") return o.id;
  if (o.value && typeof o.value.id === "string") return o.value.id;
  return "";
}

function readShopDomain(): string {
  const s = shopify.shop as { myshopifyDomain?: string; value?: { myshopifyDomain?: string } } | undefined;
  if (!s) return "";
  if (typeof s.myshopifyDomain === "string") return s.myshopifyDomain;
  if (s.value && typeof s.value.myshopifyDomain === "string") return s.value.myshopifyDomain;
  return "";
}

function App() {
  const [data, setData] = useState<PayLinkData | null>(null);

  useEffect(() => {
    const orderId = readOrderId();
    const shopDomain = readShopDomain();
    if (!orderId || !shopDomain) {
      setData({ error: "missing-context" });
      return;
    }
    const url = `https://${shopDomain}/apps/uniple-pay-link?orderId=${encodeURIComponent(orderId)}&json=1`;
    fetch(url)
      .then((r) => r.json() as Promise<PayLinkData>)
      .then(setData)
      .catch((e: Error) => setData({ error: e.message }));
  }, []);

  if (!data) return null;

  if (data.status === "paid") {
    return (
      <s-banner tone="success" heading="お支払いを確認しました">
        <s-text>uniple checkout でのお支払いが完了しています。</s-text>
      </s-banner>
    );
  }

  if (!data.checkoutUrl) {
    return null;
  }

  return (
    <s-stack direction="block" gap="large-200">
      <s-banner tone="info" heading="お支払いがまだ完了していません">
        <s-text>
          下のボタンから uniple のチェックアウトに進み、 JPYC でお支払いください。
        </s-text>
      </s-banner>
      <s-button variant="primary" href={data.checkoutUrl} inlineSize="fill">
        uniple checkout (JPYC) で支払う
      </s-button>
    </s-stack>
  );
}

export default function () {
  render(<App />, document.body);
}
