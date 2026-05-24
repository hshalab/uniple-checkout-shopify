/**
 * Thank you page block (= purchase.thank-you.block.render)。
 *
 * codex r82 ADJUST (= 2026-05-15 web search 査読): purchase.thank-you では
 * order creation が完了前 = lazy create endpoint の力を借りる。
 *
 * 動作 = Customer Account Order Status block と同じ pattern:
 *   - shopify.orderConfirmation.value.order.id から GID 取得
 *   - /apps/uniple-pay-link?orderId=<gid>&json=1 を fetch
 *   - status=pending → button、 paid → success banner、 未着 → silent
 *
 * 補助 CTA の位置付け (= primary は Order Status block + email)、 timing 競合で
 * 即時表示できない場合は order status page で確実 fallback。
 */

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

declare const shopify: {
  orderConfirmation?: { value?: { order?: { id?: string } } };
  shop?: { myshopifyDomain?: string } | { value?: { myshopifyDomain?: string } };
};

interface PayLinkData {
  status?: string;
  checkoutUrl?: string;
  error?: string;
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
    const orderId = shopify.orderConfirmation?.value?.order?.id ?? "";
    const shopDomain = readShopDomain();
    if (!orderId || !shopDomain) {
      return;
    }
    const url = `https://${shopDomain}/apps/uniple-pay-link?orderId=${encodeURIComponent(orderId)}&json=1`;
    fetch(url)
      .then((r) => r.json() as Promise<PayLinkData>)
      .then(setData)
      .catch(() => {});
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
      <s-banner tone="info" heading="JPYC でお支払いください">
        <s-text>
          ご注文を承りました。 下のボタンから uniple のチェックアウトに進み、
          JPYC でお支払いください。
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
