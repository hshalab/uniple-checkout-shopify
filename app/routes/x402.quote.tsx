// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

import type { ActionFunctionArgs } from "react-router";
import { createShopifyX402Quote, QuoteInputError } from "../lib/shopify-x402-quote.server";

export const loader = async () => {
  return jsonResponse(405, { ok: false, error: "method_not_allowed" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await request.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(400, { ok: false, error: "invalid_json" });
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }

  try {
    const quote = await createShopifyX402Quote(payload);
    return jsonResponse(200, { ok: true, quote });
  } catch (e) {
    if (e instanceof QuoteInputError) {
      return jsonResponse(400, { ok: false, error: e.message });
    }
    console.error("[uniple-checkout] x402 quote failed", e);
    return jsonResponse(500, { ok: false, error: "quote_failed" });
  }
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
