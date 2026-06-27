// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

import { describe, expect, it } from "vitest";
import { normalizeJapaneseAddressLines } from "../jp-address.server";

describe("normalizeJapaneseAddressLines", () => {
  it("removes duplicated city prefixes and promotes street line when needed", () => {
    expect(
      normalizeJapaneseAddressLines({
        prefecture: "東京都",
        city: "世田谷区",
        address1: "世田谷区 世田谷区",
        address2: "喜多見 123",
      }),
    ).toEqual({
      city: "世田谷区",
      address1: "喜多見 123",
      address2: "",
    });
  });

  it("keeps a normal street line and building line", () => {
    expect(
      normalizeJapaneseAddressLines({
        prefecture: "東京都",
        city: "千代田区",
        address1: "千代田1-1",
        address2: "テストビル101",
      }),
    ).toEqual({
      city: "千代田区",
      address1: "千代田1-1",
      address2: "テストビル101",
    });
  });
});
