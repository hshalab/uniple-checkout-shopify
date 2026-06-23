// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

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
  AppProvider as PolarisAppProvider,
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
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { UnipleClient } from "../lib/uniple-client.server";
import { syncShopifyX402Products, type ShopifyX402SyncResult } from "../lib/shopify-x402-product-sync.server";

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
  x402Sync?: Pick<ShopifyX402SyncResult, "synced" | "active" | "inactive" | "skipped">;
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
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  if (intent === "x402_sync") {
    const settings = await db.shopSettings.findUnique({ where: { shop } });
    if (!settings || !settings.apiKey) {
      return { error: "Merchant API keyを保存してから x402商品同期を実行してください。" };
    }
    try {
      const result = await syncShopifyX402Products(
        admin,
        shop,
        new UnipleClient({
          apiKey: settings.apiKey,
          webhookSecret: settings.webhookSecret,
          merchantLabel: settings.merchantLabel,
          apiBaseUrl: settings.apiBaseUrl,
          mode: settings.mode as "live" | "test",
        }),
      );
      return {
        ok: true,
        x402Sync: {
          synced: result.synced,
          active: result.active,
          inactive: result.inactive,
          skipped: result.skipped,
        },
      };
    } catch (e) {
      return { error: `x402商品同期に失敗しました: ${(e as Error).message}` };
    }
  }

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
    if (actionData?.ok && !actionData.x402Sync) {
      setSavedFlash(true);
      const timer = setTimeout(() => setSavedFlash(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [actionData?.ok, actionData?.x402Sync]);

  return (
    <PolarisAppProvider i18n={enTranslations}>
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
            {actionData?.x402Sync && (
              <Box paddingBlockEnd="400">
                <Banner tone="success" title="x402商品同期">
                  <p>
                    x402商品同期を実行しました。同期: {actionData.x402Sync.synced}件 / 有効:{" "}
                    {actionData.x402Sync.active}件 / 無効: {actionData.x402Sync.inactive}件 /
                    同期対象外: {actionData.x402Sync.skipped}件
                  </p>
                </Banner>
              </Box>
            )}

            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="save" />
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
            <Box paddingBlockStart="400">
              <Card>
                <Form method="post">
                  <input type="hidden" name="intent" value="x402_sync" />
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      x402 / AI購入 商品同期
                    </Text>
                    <Text as="p" tone="subdued">
                      Shopifyの商品バリエーションをunipleの商品catalogへ同期します。公開中・購入可能なバリエーションは有効として同期されます。
                    </Text>
                    <Text as="p" tone="subdued">
                      通常のHosted Checkout / LINE / WalletConnect決済フローは変更されません。
                    </Text>
                    <InlineStack align="end">
                      <Button submit loading={submitting}>
                        x402商品同期
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
              </Card>
            </Box>
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
                  Route flow: Manual Payment + order confirmation email pay link
                  (= email-only design).
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </PolarisAppProvider>
  );
}
