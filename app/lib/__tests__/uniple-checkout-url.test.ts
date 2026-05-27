import { describe, expect, it } from "vitest";
import { buildUnipleCheckoutUrl } from "../uniple-checkout-url.server";

describe("buildUnipleCheckoutUrl", () => {
  it("uses the configured dev host", () => {
    expect(buildUnipleCheckoutUrl("https://dev.uniple.io", "ucs_test")).toBe(
      "https://dev.uniple.io/checkout/ucs_test",
    );
  });

  it("strips trailing slashes and query/hash from the base URL", () => {
    expect(buildUnipleCheckoutUrl("https://dev.uniple.io///?x=1#top", "ucs_test")).toBe(
      "https://dev.uniple.io/checkout/ucs_test",
    );
  });

  it("falls back to production for missing or invalid base URLs", () => {
    expect(buildUnipleCheckoutUrl("", "ucs_test")).toBe("https://uniple.io/checkout/ucs_test");
    expect(buildUnipleCheckoutUrl("not-a-url", "ucs_test")).toBe(
      "https://uniple.io/checkout/ucs_test",
    );
  });
});
