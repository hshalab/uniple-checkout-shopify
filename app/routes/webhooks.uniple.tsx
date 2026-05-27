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
import db from "../db.server";
import { UnipleClient } from "../lib/uniple-client.server";
import { unauthenticated } from "../shopify.server";
import { setUnipleOrderMetafields } from "../lib/shopify-metafields.server";

const ORDER_MARK_AS_PAID_MUTATION = `#graphql
  mutation OrderMarkAsPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order { id displayFinancialStatus }
      userErrors { field message }
    }
  }
`;

type UnipleWebhookData = {
  sessionId?: string;
  session_id?: string;
  clientReferenceId?: string;
  client_reference_id?: string;
  status?: string;
  txHash?: string;
  tx_hash?: string;
  transactionId?: string;
  transaction_id?: string;
  payer?: string;
  payerAddress?: string;
  payer_address?: string;
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
  if (!sessionId) {
    return jsonResponse(400, { error: "missing_session_id" });
  }
  const eventId = String(payload.eventId ?? payload.event_id ?? "");
  const type = String(payload.type ?? payload.event ?? payload.eventType ?? "");
  const status = String(data.status ?? "");

  const mapping = await db.orderMapping.findUnique({ where: { unipleSessionId: sessionId } });
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
    // metafield update (= UI extension の banner 切替、 失敗しても paid 自体は確定済)
    try {
      await setUnipleOrderMetafields(mapping.shop, mapping.shopifyOrderId, { status: "paid" }, admin);
    } catch (metaErr) {
      console.warn("[uniple] paid metafield update failed", (metaErr as Error).message);
    }
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
