// Copyright (C) 2026 uniple inc.
// SPDX-License-Identifier: GPL-2.0-or-later

import db from "../db.server";
import { extractNumericIdFromGid } from "./shopify-gid.server";
import type { ProductSyncItem } from "./uniple-client.server";
import { UnipleClient } from "./uniple-client.server";

const MAX_PRODUCTS_PER_SYNC = 200;

const PRODUCT_VARIANTS_QUERY = `#graphql
  query X402ProductVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        legacyResourceId
        title
        displayName
        price
        availableForSale
        inventoryQuantity
        product {
          id
          legacyResourceId
          title
          handle
          descriptionHtml
          status
          onlineStoreUrl
          featuredMedia {
            preview {
              image { url }
            }
          }
        }
      }
    }
  }
`;

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ProductVariantNode = {
  id?: string;
  legacyResourceId?: string | number;
  title?: string;
  displayName?: string;
  price?: string;
  availableForSale?: boolean;
  inventoryQuantity?: number | null;
  product?: {
    id?: string;
    legacyResourceId?: string | number;
    title?: string;
    handle?: string;
    descriptionHtml?: string;
    status?: string;
    onlineStoreUrl?: string | null;
    featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null;
  } | null;
};

export type ShopifyX402SyncResult = {
  synced: number;
  active: number;
  inactive: number;
  skipped: number;
  response: Record<string, unknown>;
};

export async function syncShopifyX402Products(
  admin: AdminClient,
  shop: string,
  client: UnipleClient,
): Promise<ShopifyX402SyncResult> {
  const products: ProductSyncItem[] = [];
  const localRows: Array<{
    externalId: string;
    shopifyProductId: string;
    shopifyVariantId: string;
    name: string;
    priceJpyc: string;
    active: boolean;
  }> = [];
  let active = 0;
  let inactive = 0;
  let skipped = 0;
  let after: string | null = null;
  let sortOrder = 0;

  while (products.length < MAX_PRODUCTS_PER_SYNC) {
    const response = await admin.graphql(PRODUCT_VARIANTS_QUERY, {
      variables: { first: Math.min(100, MAX_PRODUCTS_PER_SYNC - products.length), after },
    });
    const json = (await response.json()) as {
      data?: {
        productVariants?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: ProductVariantNode[];
        };
      };
      errors?: unknown;
    };
    if (json.errors) {
      throw new Error("shopify_product_query_failed");
    }
    const connection = json.data?.productVariants;
    const nodes = connection?.nodes ?? [];
    if (nodes.length === 0) break;

    for (const node of nodes) {
      const item = toSyncItem(shop, node, sortOrder++);
      if (!item) {
        ++skipped;
        continue;
      }
      products.push(item.product);
      localRows.push(item.local);
      item.product.active ? ++active : ++inactive;
      if (products.length >= MAX_PRODUCTS_PER_SYNC) break;
    }

    if (!connection?.pageInfo?.hasNextPage || products.length >= MAX_PRODUCTS_PER_SYNC) {
      break;
    }
    after = connection.pageInfo.endCursor ?? null;
    if (!after) break;
  }

  const response = await client.syncProducts(products);
  const syncedAt = new Date();
  for (const row of localRows) {
    await db.x402Product.upsert({
      where: { externalId: row.externalId },
      create: { shop, syncedAt, ...row },
      update: {
        shop,
        shopifyProductId: row.shopifyProductId,
        shopifyVariantId: row.shopifyVariantId,
        name: row.name,
        priceJpyc: row.priceJpyc,
        active: row.active,
        syncedAt,
      },
    });
  }

  return {
    synced: products.length,
    active,
    inactive,
    skipped,
    response,
  };
}

function toSyncItem(
  shop: string,
  node: ProductVariantNode,
  sortOrder: number,
): { product: ProductSyncItem; local: {
  externalId: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  name: string;
  priceJpyc: string;
  active: boolean;
} } | null {
  const variantId = String(node.id ?? "");
  const productId = String(node.product?.id ?? "");
  if (!variantId || !productId) return null;

  const variantNumericId = String(
    node.legacyResourceId ?? extractNumericIdFromGid(variantId, "ProductVariant"),
  );
  const productNumericId = String(
    node.product?.legacyResourceId ?? extractNumericIdFromGid(productId, "Product"),
  );
  const priceJpyc = normalizePriceJpyc(node.price ?? "");
  if (!priceJpyc) return null;

  const externalId = `shopify-product-${productNumericId}-variant-${variantNumericId}`;
  const name = truncate(node.displayName || node.product?.title || node.title || "Shopify product", 255);
  const active = node.product?.status === "ACTIVE" && node.availableForSale === true;
  const pageUrl = node.product?.onlineStoreUrl || `https://${shop}/products/${node.product?.handle ?? ""}`;
  const imageUrl = node.product?.featuredMedia?.preview?.image?.url ?? "";

  return {
    product: {
      externalId,
      name,
      priceJpyc,
      active,
      description: truncate(stripHtml(node.product?.descriptionHtml ?? ""), 1000),
      imageUrl,
      pageUrl,
      taxLabel: "税込",
      sortOrder,
    },
    local: {
      externalId,
      shopifyProductId: productId,
      shopifyVariantId: variantId,
      name,
      priceJpyc,
      active,
    },
  };
}

function normalizePriceJpyc(value: unknown): string | null {
  const s = String(value ?? "").trim();
  const match = s.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const integer = match[1].replace(/^0+/, "") || "0";
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (integer === "0" && fraction === "") return null;
  return fraction ? `${integer}.${fraction}` : integer;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
