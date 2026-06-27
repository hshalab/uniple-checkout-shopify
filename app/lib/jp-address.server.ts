// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

type JapaneseAddressInput = {
  prefecture?: string;
  city?: string;
  address1?: string;
  address2?: string;
};

export type JapaneseAddressLines = {
  city: string;
  address1: string;
  address2: string;
};

export function normalizeJapaneseAddressLines(input: JapaneseAddressInput): JapaneseAddressLines {
  const prefecture = cleanAddressPart(input.prefecture);
  const city = stripLeadingParts(cleanAddressPart(input.city), [prefecture]);
  let address1 = stripLeadingParts(cleanAddressPart(input.address1), [prefecture, city]);
  let address2 = stripLeadingParts(cleanAddressPart(input.address2), [prefecture, city]);

  if (!address1 && address2) {
    address1 = address2;
    address2 = "";
  }

  if (address2 === address1) {
    address2 = "";
  }

  return { city, address1, address2 };
}

function cleanAddressPart(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).replace(/\s+/gu, " ").trim()
    : "";
}

function stripLeadingParts(value: string, parts: string[]): string {
  let result = value;
  for (const part of parts) {
    if (!part) continue;
    result = stripRepeatedPrefix(result, part);
  }
  return result.trim();
}

function stripRepeatedPrefix(value: string, prefix: string): string {
  let result = value.trim();
  const normalizedPrefix = prefix.trim();
  if (!normalizedPrefix) return result;

  while (result === normalizedPrefix || result.startsWith(`${normalizedPrefix} `)) {
    result = result.slice(normalizedPrefix.length).trim();
  }

  return result;
}
