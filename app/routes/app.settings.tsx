/**
 * uniple settings page.
 *
 * Admin → Apps → uniple checkout → Settings で API key + Webhook secret を入力。
 * codex r70 ADJUST: 別 `ShopSettings` table + masked display + capability =
 * Shopify admin context (= authenticate.admin の session) でアクセス制御。
 */

import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const MASK = "••••••••";

interface LoaderData {
  shop: string;
  settings: {
    apiBaseUrl: string;
    apiKey: string; // masked
    webhookSecret: string; // masked
    merchantLabel: string;
    mode: "live" | "test";
    hasApiKey: boolean;
    hasWebhookSecret: boolean;
  };
}

interface ActionData {
  ok?: boolean;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  return {
    shop,
    settings: {
      apiBaseUrl: settings?.apiBaseUrl ?? "https://uniple.io",
      apiKey: settings?.apiKey ? MASK : "",
      webhookSecret: settings?.webhookSecret ? MASK : "",
      merchantLabel: settings?.merchantLabel ?? "",
      mode: ((settings?.mode as "live" | "test") ?? "live") as "live" | "test",
      hasApiKey: Boolean(settings?.apiKey),
      hasWebhookSecret: Boolean(settings?.webhookSecret),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const apiBaseUrl = String(formData.get("apiBaseUrl") ?? "https://uniple.io").trim();
  const merchantLabel = String(formData.get("merchantLabel") ?? "").trim();
  const mode = (String(formData.get("mode") ?? "live") === "test" ? "test" : "live") as
    | "live"
    | "test";
  const apiKeyInput = String(formData.get("apiKey") ?? "");
  const webhookSecretInput = String(formData.get("webhookSecret") ?? "");

  const existing = await db.shopSettings.findUnique({ where: { shop } });

  // mask または空のときは既存値を維持 (= EC-CUBE 4 / WC plugin と同 pattern)
  const preserveIfMasked = (value: string, current: string): string => {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === MASK) return current;
    return trimmed;
  };

  const apiKey = preserveIfMasked(apiKeyInput, existing?.apiKey ?? "");
  const webhookSecret = preserveIfMasked(webhookSecretInput, existing?.webhookSecret ?? "");

  await db.shopSettings.upsert({
    where: { shop },
    create: {
      shop,
      apiBaseUrl,
      apiKey,
      webhookSecret,
      merchantLabel,
      mode,
    },
    update: {
      apiBaseUrl,
      apiKey,
      webhookSecret,
      merchantLabel,
      mode,
    },
  });
  return { ok: true };
};

export default function Settings() {
  const { shop, settings } = useLoaderData<typeof loader>() as LoaderData;
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [merchantLabel, setMerchantLabel] = useState(settings.merchantLabel);
  const [mode, setMode] = useState<"live" | "test">(settings.mode);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [webhookSecret, setWebhookSecret] = useState(settings.webhookSecret);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (actionData?.ok) {
      setSavedFlash(true);
      const timer = setTimeout(() => setSavedFlash(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [actionData?.ok]);

  return (
    <Page title="uniple checkout settings" subtitle={`Shop: ${shop}`}>
      <Layout>
        <Layout.Section>
          {savedFlash && (
            <Box paddingBlockEnd="400">
              <Banner tone="success" title="Settings saved">
                <p>uniple credentials updated.</p>
              </Banner>
            </Box>
          )}
          {actionData?.error && (
            <Box paddingBlockEnd="400">
              <Banner tone="critical" title="Failed to save">
                <p>{actionData.error}</p>
              </Banner>
            </Box>
          )}

          <Card>
            <Form method="post">
              <FormLayout>
                <TextField
                  label="API base URL"
                  name="apiBaseUrl"
                  value={apiBaseUrl}
                  onChange={setApiBaseUrl}
                  autoComplete="off"
                  helpText="Default: https://uniple.io"
                />
                <TextField
                  label="Merchant label"
                  name="merchantLabel"
                  value={merchantLabel}
                  onChange={setMerchantLabel}
                  autoComplete="off"
                  helpText="Displayed on the uniple checkout page."
                />
                <Select
                  label="Mode"
                  name="mode"
                  options={[
                    { label: "Live", value: "live" },
                    { label: "Test", value: "test" },
                  ]}
                  value={mode}
                  onChange={(v: string) => setMode(v as "live" | "test")}
                />
                <TextField
                  label="API key"
                  name="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={setApiKey}
                  autoComplete="off"
                  helpText="Issued by uniple admin. Stored masked; submit blank or the mask to keep the current value."
                />
                <TextField
                  label="Webhook secret"
                  name="webhookSecret"
                  type="password"
                  value={webhookSecret}
                  onChange={setWebhookSecret}
                  autoComplete="off"
                  helpText="HMAC-SHA256 webhook signing secret."
                />
                <InlineStack align="end">
                  <Button submit variant="primary" loading={submitting}>
                    Save settings
                  </Button>
                </InlineStack>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Status
              </Text>
              <Text as="p" tone="subdued">
                API key: {settings.hasApiKey ? "set" : "not set"}
              </Text>
              <Text as="p" tone="subdued">
                Webhook secret: {settings.hasWebhookSecret ? "set" : "not set"}
              </Text>
              <Text as="p" tone="subdued">
                Route flow: Manual Payment + order confirmation email pay link (= Path A').
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
