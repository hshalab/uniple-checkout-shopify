import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";
import { authenticate } from "../shopify.server";

const SETUP_DOC_PATH = "/docs/merchant-integration-spec";
const FAQ_DOC_PATH = "/docs/merchant-integration-spec#9-troubleshooting-faq";
const MERCHANT_APPLICATION_URL = "https://forms.gle/b8kwVZeynA1ffV8j6";
const SUPPORT_EMAIL = "support@uniple.io";
const APP_SUMMARY = "uniple checkout — JPYC stablecoin payment integration.";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await db.shopSettings.findUnique({
    where: { shop: session.shop },
    select: {
      apiBaseUrl: true,
      apiKey: true,
      webhookSecret: true,
      mode: true,
    },
  });

  const hasApiBaseUrl = Boolean(settings?.apiBaseUrl?.trim());
  const hasApiKey = Boolean(settings?.apiKey?.trim());
  const hasWebhookSecret = Boolean(settings?.webhookSecret?.trim());
  const ready = hasApiBaseUrl && hasApiKey && hasWebhookSecret;

  return {
    shop: session.shop,
    ready,
    mode: settings?.mode ?? "live",
    checks: {
      apiBaseUrl: hasApiBaseUrl,
      apiKey: hasApiKey,
      webhookSecret: hasWebhookSecret,
    },
  };
};

export default function Index() {
  const { shop, ready, mode, checks } = useLoaderData<typeof loader>();

  return (
    <s-page heading="uniple checkout">
      <s-section heading="Welcome">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-icon type="payment" tone="info" />
            <s-stack direction="block" gap="small">
              <s-heading>uniple checkout</s-heading>
              <s-paragraph>{APP_SUMMARY}</s-paragraph>
            </s-stack>
          </s-stack>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text type="strong">Setup status</s-text>
                <s-badge
                  tone={ready ? "success" : "warning"}
                  icon={ready ? "check-circle" : "alert-circle"}
                >
                  {ready ? "Ready" : "Setup required"}
                </s-badge>
              </s-stack>
              <s-paragraph color="subdued">
                Shop: {shop} / Mode: {mode}
              </s-paragraph>
              <s-paragraph color="subdued">
                Required settings: API base URL, API key, and webhook secret.
              </s-paragraph>
            </s-stack>
          </s-box>

          <s-stack direction="inline" gap="base">
            <s-button variant="primary" href={SETUP_DOC_PATH} target="_blank">
              Setup guide
            </s-button>
            <s-button href="/app/settings">Open settings</s-button>
            <s-button href={MERCHANT_APPLICATION_URL} target="_blank">
              Apply for uniple merchant account
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Next steps">
        <s-unordered-list>
          <s-list-item>
            Apply for a uniple merchant account and receive API credentials.
          </s-list-item>
          <s-list-item>
            Save the API base URL, API key, webhook secret, and mode in{" "}
            <s-link href="/app/settings">Settings</s-link>.
          </s-list-item>
          <s-list-item>
            Add the manual payment method and paste the order confirmation email
            Liquid snippet from the{" "}
            <s-link href={SETUP_DOC_PATH} target="_blank">
              merchant integration spec
            </s-link>
            .
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Configuration">
        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge
              tone={checks.apiBaseUrl ? "success" : "warning"}
              icon={checks.apiBaseUrl ? "check-circle" : "alert-circle"}
            >
              API base URL
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge
              tone={checks.apiKey ? "success" : "warning"}
              icon={checks.apiKey ? "check-circle" : "alert-circle"}
            >
              API key
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge
              tone={checks.webhookSecret ? "success" : "warning"}
              icon={checks.webhookSecret ? "check-circle" : "alert-circle"}
            >
              Webhook secret
            </s-badge>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Support">
        <s-unordered-list>
          <s-list-item>
            <s-link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href={FAQ_DOC_PATH} target="_blank">
              Merchant FAQ
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href={MERCHANT_APPLICATION_URL} target="_blank">
              uniple merchant application
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
