// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Shopify GID 正規化 helper。
 *
 * Shopify webhook payload は order id を numeric (= 5497432043521) で返すが、
 * GraphQL Admin API mutation (= orderMarkAsPaid) は GID (= "gid://shopify/Order/<num>")
 * を要求する。 plugin 内では GID を SSOT、 入力時に正規化。
 *
 * codex 査読 r70 ADJUST: GID 正規化 + numeric 両保持で webhook 互換と GraphQL 整合。
 */

const RESOURCE = "Order";
const PREFIX = `gid://shopify/${RESOURCE}/`;

export function normalizeOrderGid(input: string | number): string {
  const s = String(input).trim();
  if (s.startsWith(PREFIX)) {
    return s;
  }
  if (/^\d+$/.test(s)) {
    return PREFIX + s;
  }
  throw new Error(`unrecognized Shopify Order id: ${s}`);
}

export function extractOrderNumericId(input: string | number): string {
  const s = String(input).trim();
  if (s.startsWith(PREFIX)) {
    return s.slice(PREFIX.length);
  }
  if (/^\d+$/.test(s)) {
    return s;
  }
  throw new Error(`unrecognized Shopify Order id: ${s}`);
}

export function extractNumericIdFromGid(input: string | number, resource: string): string {
  const s = String(input).trim();
  const prefix = `gid://shopify/${resource}/`;
  if (s.startsWith(prefix)) {
    const numeric = s.slice(prefix.length);
    if (/^\d+$/.test(numeric)) return numeric;
  }
  if (/^\d+$/.test(s)) {
    return s;
  }
  throw new Error(`unrecognized Shopify ${resource} id: ${s}`);
}
