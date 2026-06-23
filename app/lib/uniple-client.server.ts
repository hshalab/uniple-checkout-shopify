// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * uniple Merchant API thin client for Shopify app.
 *
 * EC-CUBE 4 (Guzzle) / EC-CUBE 2 (curl) / WooCommerce (wp_remote_*) plugin の
 * logic を Node.js built-in fetch に移植。 r22 thin client 方針継承:
 *   - POST /api/merchant/checkout/sessions → checkoutUrl 取得 + redirect
 *   - GET /api/merchant/checkout/sessions/<id> = option C fallback
 *   - HMAC-SHA256 signature 検証 (= raw body + timingSafeEqual)
 *
 * 経路振り分け (= wc / line / both) は uniple SSR で完結、 plugin は thin client。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { toIntegerJpyc } from "./uniple-amount.server";
import { buildUserAgent } from "./uniple-user-agent.server";

export interface UnipleConfig {
  apiKey: string;
  webhookSecret: string;
  merchantLabel: string;
  apiBaseUrl: string;
  mode: "live" | "test";
}

export interface CreateSessionParams {
  amountJpyc: number | string;
  merchantOrderId: string;
  itemName: string;
  successUrl: string;
  cancelUrl: string;
  webhookUrl: string;
}

export interface CreateSessionResult {
  ok: true;
  sessionId: string;
  checkoutUrl: string;
  payId: string;
  status: string;
  expiresAt: string;
}

export interface GetSessionResult {
  ok?: boolean;
  item?: {
    sessionId: string;
    status: string;
    amountJpyc: string;
    txHash?: string;
    transactionId?: string;
    payer?: string;
    clientReferenceId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  error?: string;
  httpStatus: number;
}

export interface ProductSyncItem {
  externalId: string;
  name: string;
  priceJpyc: string;
  active: boolean;
  description?: string;
  imageUrl?: string;
  pageUrl?: string;
  taxLabel?: string;
  sortOrder?: number;
}

const TIMEOUT_MS = 5000;

export class UnipleApiError extends Error {
  status: number;
  body?: string;
  constructor(message: string, status = 0, body?: string) {
    super(message);
    this.name = "UnipleApiError";
    this.status = status;
    this.body = body;
  }
}

export class UnipleClient {
  constructor(private readonly config: UnipleConfig) {}

  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    if (!this.config.apiKey) {
      throw new UnipleApiError("uniple_api_key_not_configured", 503);
    }
    const amountInt = toIntegerJpyc(params.amountJpyc);
    const body = {
      amountJpyc: String(amountInt),
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      clientReferenceId: String(params.merchantOrderId),
      merchantLabel: this.config.merchantLabel,
      description: params.itemName,
      lineItems: [
        {
          name: params.itemName,
          quantity: 1,
          amountJpyc: amountInt,
        },
      ],
      splitEngine: "v3",
      webhookUrl: params.webhookUrl,
    };

    const endpoint = this.endpoint("/api/merchant/checkout/sessions");
    const response = await this.fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": buildUserAgent(),
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    if (response.status !== 200) {
      throw new UnipleApiError(
        `uniple_session_failed: status=${response.status}`,
        response.status,
        raw.slice(0, 300),
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new UnipleApiError("uniple_session_non_json", response.status, raw.slice(0, 300));
    }
    const p = payload as {
      ok?: boolean;
      session?: Record<string, unknown>;
      data?: Record<string, unknown>;
    };
    if (!p.ok) {
      throw new UnipleApiError("uniple_session_not_ok", response.status, raw.slice(0, 300));
    }
    const session = (p.session ?? p.data ?? p) as Record<string, unknown>;
    const sessionId = String(session.sessionId ?? "");
    const checkoutUrl = String(session.checkoutUrl ?? "");
    if (!sessionId || !checkoutUrl) {
      throw new UnipleApiError("uniple_session_missing_url", response.status, raw.slice(0, 300));
    }
    return {
      ok: true,
      sessionId,
      checkoutUrl,
      payId: String(session.payId ?? ""),
      status: String(session.status ?? ""),
      expiresAt: String(session.expiresAt ?? ""),
    };
  }

  async getCheckoutSession(sessionId: string): Promise<GetSessionResult> {
    if (!sessionId) {
      throw new UnipleApiError("sessionId empty", 0);
    }
    if (!this.config.apiKey) {
      throw new UnipleApiError("uniple_api_key_not_configured", 503);
    }
    const endpoint = this.endpoint(
      `/api/merchant/checkout/sessions/${encodeURIComponent(sessionId)}`,
    );
    const response = await this.fetchWithTimeout(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "application/json",
        "User-Agent": buildUserAgent(),
      },
    });
    const raw = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new UnipleApiError("uniple_session_lookup_non_json", response.status, raw.slice(0, 300));
    }
    return {
      ...(data as Omit<GetSessionResult, "httpStatus">),
      httpStatus: response.status,
    };
  }

  async syncProducts(products: ProductSyncItem[]): Promise<Record<string, unknown>> {
    if (products.length > 200) {
      throw new UnipleApiError("products max 200", 400);
    }
    if (!this.config.apiKey) {
      throw new UnipleApiError("uniple_api_key_not_configured", 503);
    }

    const response = await this.fetchWithTimeout(this.endpoint("/api/merchant/products"), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": buildUserAgent(),
      },
      body: JSON.stringify({ products }),
    });

    const raw = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new UnipleApiError("uniple_products_non_json", response.status, raw.slice(0, 300));
    }
    if (response.status < 200 || response.status >= 300 || payload.ok === false) {
      throw new UnipleApiError(
        `uniple_products_failed: status=${response.status}`,
        response.status,
        raw.slice(0, 300),
      );
    }

    return { ...payload, httpStatus: response.status };
  }

  verifySignature(rawBody: string, sigHeader: string): boolean {
    const secret = this.config.webhookSecret;
    if (!sigHeader || !secret) return false;
    const provided = sigHeader.replace(/^sha256=/, "").trim();
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  }

  private endpoint(path: string): string {
    const base = (this.config.apiBaseUrl || "https://uniple.io").replace(/\/+$/, "");
    return base + path;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        throw new UnipleApiError("uniple_session_timeout", 0);
      }
      throw new UnipleApiError(`uniple_session_unreachable: ${err.message}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }
}
