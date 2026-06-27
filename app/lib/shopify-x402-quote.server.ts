// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

import { randomBytes } from "node:crypto";
import db from "../db.server";
import { normalizeJapaneseAddressLines } from "./jp-address.server";

const QUOTE_TTL_SECONDS = 15 * 60;
const SCALE = 1_000_000n;

type X402ProductRecord = {
  shop: string;
  externalId: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  name: string;
  priceJpyc: string;
  active: boolean;
};

export type ShopifyX402Quote = {
  quoteId: string;
  productSku: string;
  quantity: number;
  productSubtotalJpyc: string;
  shippingFeeJpyc: string;
  discountJpyc: string;
  totalJpyc: string;
  expiresAt: string;
  shipping: Record<string, string>;
  quoteSource: "shopify";
};

export type ShopifyX402QuoteValidation =
  | {
      ok: true;
      quote: ShopifyX402QuoteRecord;
    }
  | {
      ok: false;
      error: string;
    };

export type ShopifyX402QuoteRecord = {
  quoteId: string;
  shop: string;
  productSku: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  quantity: number;
  productSubtotalJpyc: string;
  shippingFeeJpyc: string;
  discountJpyc: string;
  totalJpyc: string;
  shippingJson: string;
  shippingRateId: string | null;
  shippingRateLabel: string | null;
  quoteSource: string;
  expiresAt: Date;
  usedAt: Date | null;
};

type ShippingQuote = {
  shippingFeeJpyc: string;
  shippingRateId: string;
  shippingRateLabel: string;
};

export async function createShopifyX402Quote(payload: Record<string, unknown>): Promise<ShopifyX402Quote> {
  const productSku = readString(payload, ["productSku", "product_sku", "externalId", "external_id"]);
  if (!productSku) throw new QuoteInputError("product_sku_required");

  const product = await db.x402Product.findUnique({ where: { externalId: productSku } });
  if (!product) throw new QuoteInputError("product_not_found");
  const x402Product = product as X402ProductRecord;
  if (!x402Product.active) throw new QuoteInputError("product_not_available");

  const quantity = readPositiveInteger(payload, ["quantity", "qty"], 1);
  if (quantity < 1 || quantity > 99) throw new QuoteInputError("invalid_quantity");

  const unitPrice = normalizeJpycAmount(x402Product.priceJpyc, { allowZero: false });
  if (!unitPrice) throw new Error("invalid_product_price");
  const productSubtotal = multiplyAmount(unitPrice, quantity);
  const discount = "0";
  const shipping = normalizeShipping(shippingPayload(payload));
  const shippingQuote = configuredShippingQuote(productSubtotal);
  const total = addAmounts(productSubtotal, shippingQuote.shippingFeeJpyc);
  if (!normalizeJpycAmount(total, { allowZero: false })) throw new Error("invalid_total");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000);
  const quoteId = `uq_${randomBytes(16).toString("hex")}`;

  const record = await db.x402Quote.create({
    data: {
      quoteId,
      shop: x402Product.shop,
      productSku,
      shopifyProductId: x402Product.shopifyProductId,
      shopifyVariantId: x402Product.shopifyVariantId,
      quantity,
      productSubtotalJpyc: productSubtotal,
      shippingFeeJpyc: shippingQuote.shippingFeeJpyc,
      discountJpyc: discount,
      totalJpyc: total,
      shippingJson: JSON.stringify(shipping),
      shippingRateId: shippingQuote.shippingRateId || null,
      shippingRateLabel: shippingQuote.shippingRateLabel || null,
      quoteSource: "shopify",
      expiresAt,
    },
  });

  return publicQuote(record as ShopifyX402QuoteRecord);
}

export async function validateShopifyX402Quote({
  data,
  productSku,
  x402Product,
  amountJpyc,
}: {
  data: Record<string, unknown>;
  productSku: string;
  x402Product: Pick<X402ProductRecord, "shop" | "externalId" | "shopifyProductId" | "shopifyVariantId">;
  amountJpyc: string;
}): Promise<ShopifyX402QuoteValidation> {
  const quoteId = readString(data, ["quoteId", "quote_id"]);
  if (!quoteId) return { ok: false, error: "quote_id_missing" };

  const found = await db.x402Quote.findUnique({ where: { quoteId } });
  if (!found) return { ok: false, error: "quote_not_found" };
  const quote = found as ShopifyX402QuoteRecord;
  if (quote.usedAt) return { ok: false, error: "quote_already_used" };
  if (quote.expiresAt.getTime() <= Date.now()) return { ok: false, error: "quote_expired" };
  if (
    quote.shop !== x402Product.shop ||
    quote.productSku !== productSku ||
    quote.shopifyProductId !== x402Product.shopifyProductId ||
    quote.shopifyVariantId !== x402Product.shopifyVariantId
  ) {
    return { ok: false, error: "quote_product_mismatch" };
  }
  if (quote.totalJpyc !== amountJpyc) return { ok: false, error: "quote_amount_mismatch" };

  const quantity = readOptionalInteger(data, ["quantity", "qty"]);
  if (quantity !== null && quantity !== quote.quantity) return { ok: false, error: "quote_quantity_mismatch" };

  const subtotal = readOptionalAmount(data, ["productSubtotalJpyc", "product_subtotal_jpyc"]);
  if (subtotal !== null && subtotal !== quote.productSubtotalJpyc) {
    return { ok: false, error: "quote_product_subtotal_mismatch" };
  }
  const shippingFee = readOptionalAmount(data, ["shippingFeeJpyc", "shipping_fee_jpyc"]);
  if (shippingFee !== null && shippingFee !== quote.shippingFeeJpyc) {
    return { ok: false, error: "quote_shipping_fee_mismatch" };
  }
  const total = readOptionalAmount(data, ["totalJpyc", "total_jpyc"]);
  if (total !== null && total !== quote.totalJpyc) {
    return { ok: false, error: "quote_total_mismatch" };
  }

  return { ok: true, quote };
}

export async function markShopifyX402QuoteUsed(quoteId: string): Promise<void> {
  await db.x402Quote.update({
    where: { quoteId },
    data: { usedAt: new Date() },
  });
}

export function publicQuote(record: ShopifyX402QuoteRecord): ShopifyX402Quote {
  return {
    quoteId: record.quoteId,
    productSku: record.productSku,
    quantity: record.quantity,
    productSubtotalJpyc: record.productSubtotalJpyc,
    shippingFeeJpyc: record.shippingFeeJpyc,
    discountJpyc: record.discountJpyc,
    totalJpyc: record.totalJpyc,
    expiresAt: record.expiresAt.toISOString(),
    shipping: parseShippingJson(record.shippingJson),
    quoteSource: "shopify",
  };
}

export function quoteShipping(record: ShopifyX402QuoteRecord): Record<string, unknown> {
  return parseShippingJson(record.shippingJson);
}

export function normalizeJpycAmount(value: unknown, { allowZero }: { allowZero: boolean }): string | null {
  if (value === null || value === undefined || value === false || typeof value === "object") return null;
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const integer = match[1].replace(/^0+/, "") || "0";
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (!allowZero && integer === "0" && fraction === "") return null;
  return fraction ? `${integer}.${fraction}` : integer;
}

export function addAmounts(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}

export function multiplyAmount(a: string, quantity: number): string {
  return formatScaled(parseScaled(a) * BigInt(quantity));
}

export function divideAmount(a: string, quantity: number): string | null {
  if (quantity < 1) return null;
  const scaled = parseScaled(a);
  const divisor = BigInt(quantity);
  if (scaled % divisor !== 0n) return null;
  return formatScaled(scaled / divisor);
}

export function compareAmounts(a: string, b: string): number {
  const diff = parseScaled(a) - parseScaled(b);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

export class QuoteInputError extends Error {}

function configuredShippingQuote(productSubtotal: string): ShippingQuote {
  const baseFee =
    normalizeJpycAmount(process.env.SHOPIFY_X402_SHIPPING_FEE_JPYC, { allowZero: true }) ??
    normalizeJpycAmount(process.env.X402_SHOPIFY_SHIPPING_FEE_JPYC, { allowZero: true }) ??
    "0";
  const freeMin =
    normalizeJpycAmount(process.env.SHOPIFY_X402_FREE_SHIPPING_MIN_JPYC, { allowZero: false }) ??
    normalizeJpycAmount(process.env.X402_SHOPIFY_FREE_SHIPPING_MIN_JPYC, { allowZero: false });
  const shippingFee = freeMin && compareAmounts(productSubtotal, freeMin) >= 0 ? "0" : baseFee;

  return {
    shippingFeeJpyc: shippingFee,
    shippingRateId: process.env.SHOPIFY_X402_SHIPPING_RATE_ID ?? "shopify_x402_shipping",
    shippingRateLabel: process.env.SHOPIFY_X402_SHIPPING_LABEL ?? "送料",
  };
}

function shippingPayload(payload: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["shipping", "shippingAddress", "shipping_address", "delivery", "recipient"]) {
    const value = payload[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return payload;
}

function normalizeShipping(shipping: Record<string, unknown>): Record<string, string> {
  let firstName = readString(shipping, ["firstName", "first_name", "givenName", "given_name", "name02"]);
  let lastName = readString(shipping, ["lastName", "last_name", "familyName", "family_name", "name01"]);
  const fullName = readString(shipping, ["name", "fullName", "full_name", "recipientName", "recipient_name"]);
  if ((!firstName || !lastName) && fullName) {
    const parts = fullName.split(/\s+/u, 2);
    if (!lastName) lastName = parts[0] ?? "";
    if (!firstName) firstName = parts[1] ?? "";
  }
  const city = readString(shipping, ["city", "municipality", "ward"]);
  const address1 = readString(shipping, [
    "addr01",
    "address1",
    "address_1",
    "addressLine1",
    "address_line1",
    "line1",
    "streetAddress",
    "street_address",
  ]);
  const address2 = readString(shipping, [
    "addr02",
    "address2",
    "address_2",
    "addressLine2",
    "address_line2",
    "line2",
    "building",
    "apartment",
    "room",
  ]);
  const phone = readString(shipping, ["phoneNumber", "phone_number", "phone", "tel", "telephone"]);
  const postalCode = readString(shipping, [
    "postalCode",
    "postal_code",
    "postCode",
    "post_code",
    "zipCode",
    "zip_code",
    "zipcode",
    "zip",
  ]);
  const prefecture = normalizePrefecture(readString(shipping, ["prefecture", "pref", "prefName", "pref_name", "state", "province", "region"]));
  if (!firstName || !lastName || !address1 || !phone || !postalCode || !prefecture) {
    throw new QuoteInputError("shipping_required_field_missing");
  }

  const address = normalizeJapaneseAddressLines({ prefecture, city, address1, address2 });

  return {
    name: truncate(`${lastName} ${firstName}`.trim(), 255),
    firstName: truncate(firstName, 255),
    lastName: truncate(lastName, 255),
    email: truncate(readString(shipping, ["email", "mail"]), 255),
    phone: truncate(phone, 32),
    postalCode: truncate(postalCode, 32),
    prefecture: truncate(prefecture, 255),
    provinceCode: truncate(toShopifyProvinceCode(prefecture), 32),
    city: truncate(address.city, 255),
    address1: truncate(address.address1, 255),
    address2: truncate(address.address2, 255),
    country: "JP",
  };
}

function parseShippingJson(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function readString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
  }
  return "";
}

function readPositiveInteger(data: Record<string, unknown>, keys: string[], defaultValue: number): number {
  const value = readString(data, keys);
  if (!value) return defaultValue;
  if (!/^\d+$/.test(value)) throw new QuoteInputError("invalid_integer");
  return Number(value);
}

function readOptionalInteger(data: Record<string, unknown>, keys: string[]): number | null {
  const value = readString(data, keys);
  if (!value) return null;
  if (!/^\d+$/.test(value)) return -1;
  return Number(value);
}

function readOptionalAmount(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return normalizeJpycAmount(data[key], { allowZero: true }) ?? "__invalid__";
    }
  }
  return null;
}

function parseScaled(value: string): bigint {
  const normalized = normalizeJpycAmount(value, { allowZero: true });
  if (!normalized) throw new Error("invalid_amount");
  const [integer, fraction = ""] = normalized.split(".");
  return BigInt(integer) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function formatScaled(value: bigint): string {
  if (value < 0n) throw new Error("negative_amount");
  const integer = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${integer.toString()}.${fraction}` : integer.toString();
}

function normalizePrefecture(value: string): string {
  const map: Record<string, string> = {
    tokyo: "東京都",
    "tokyo-to": "東京都",
    osaka: "大阪府",
    "osaka-fu": "大阪府",
    kyoto: "京都府",
    "kyoto-fu": "京都府",
    hokkaido: "北海道",
    kanagawa: "神奈川県",
    saitama: "埼玉県",
    chiba: "千葉県",
    aichi: "愛知県",
    fukuoka: "福岡県",
  };
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return map[key] ?? value.trim();
}

function toShopifyProvinceCode(prefecture: string): string {
  const map: Record<string, string> = {
    北海道: "JP-01",
    青森県: "JP-02",
    岩手県: "JP-03",
    宮城県: "JP-04",
    秋田県: "JP-05",
    山形県: "JP-06",
    福島県: "JP-07",
    茨城県: "JP-08",
    栃木県: "JP-09",
    群馬県: "JP-10",
    埼玉県: "JP-11",
    千葉県: "JP-12",
    東京都: "JP-13",
    神奈川県: "JP-14",
    新潟県: "JP-15",
    富山県: "JP-16",
    石川県: "JP-17",
    福井県: "JP-18",
    山梨県: "JP-19",
    長野県: "JP-20",
    岐阜県: "JP-21",
    静岡県: "JP-22",
    愛知県: "JP-23",
    三重県: "JP-24",
    滋賀県: "JP-25",
    京都府: "JP-26",
    大阪府: "JP-27",
    兵庫県: "JP-28",
    奈良県: "JP-29",
    和歌山県: "JP-30",
    鳥取県: "JP-31",
    島根県: "JP-32",
    岡山県: "JP-33",
    広島県: "JP-34",
    山口県: "JP-35",
    徳島県: "JP-36",
    香川県: "JP-37",
    愛媛県: "JP-38",
    高知県: "JP-39",
    福岡県: "JP-40",
    佐賀県: "JP-41",
    長崎県: "JP-42",
    熊本県: "JP-43",
    大分県: "JP-44",
    宮崎県: "JP-45",
    鹿児島県: "JP-46",
    沖縄県: "JP-47",
  };
  if (/^JP-\d{2}$/.test(prefecture)) return prefecture;
  if (/^JP\d{2}$/.test(prefecture)) return `JP-${prefecture.slice(2)}`;
  return map[prefecture] ?? "";
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
