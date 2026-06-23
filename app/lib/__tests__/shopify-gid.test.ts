// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

import { describe, expect, it } from "vitest";
import {
  extractNumericIdFromGid,
  extractOrderNumericId,
  normalizeOrderGid,
} from "../shopify-gid.server";

describe("normalizeOrderGid", () => {
  it("passes through GID form", () => {
    expect(normalizeOrderGid("gid://shopify/Order/5497432043521")).toBe(
      "gid://shopify/Order/5497432043521",
    );
  });
  it("converts numeric string", () => {
    expect(normalizeOrderGid("5497432043521")).toBe("gid://shopify/Order/5497432043521");
  });
  it("converts numeric number", () => {
    expect(normalizeOrderGid(5497432043521)).toBe("gid://shopify/Order/5497432043521");
  });
  it("rejects unknown form", () => {
    expect(() => normalizeOrderGid("gid://shopify/Customer/123")).toThrow();
    expect(() => normalizeOrderGid("abc")).toThrow();
  });
});

describe("extractOrderNumericId", () => {
  it("extracts from GID", () => {
    expect(extractOrderNumericId("gid://shopify/Order/5497432043521")).toBe("5497432043521");
  });
  it("returns numeric as-is", () => {
    expect(extractOrderNumericId("5497432043521")).toBe("5497432043521");
  });
});

describe("extractNumericIdFromGid", () => {
  it("extracts ProductVariant numeric ID from GID", () => {
    expect(extractNumericIdFromGid("gid://shopify/ProductVariant/43729076", "ProductVariant")).toBe(
      "43729076",
    );
  });

  it("rejects a mismatched resource", () => {
    expect(() => extractNumericIdFromGid("gid://shopify/Product/123", "ProductVariant")).toThrow();
  });
});
