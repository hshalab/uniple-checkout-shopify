#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultLiveDbPath = path.join(repoRoot, "prisma", "dev.sqlite");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function requireArg(name) {
  const value = argValue(name, undefined);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function prismaFileUrl(dbPath) {
  return `file:${path.resolve(dbPath)}`;
}

const backupDbPath = path.resolve(requireArg("--backup"));
const liveDbPath = path.resolve(argValue("--db", defaultLiveDbPath));
const shop = requireArg("--shop");

if (!existsSync(backupDbPath)) {
  throw new Error(`Backup SQLite DB not found: ${backupDbPath}`);
}
if (!existsSync(liveDbPath)) {
  throw new Error(`Live SQLite DB not found: ${liveDbPath}`);
}

const backup = new PrismaClient({
  datasources: {
    db: {
      url: prismaFileUrl(backupDbPath),
    },
  },
});
const live = new PrismaClient({
  datasources: {
    db: {
      url: prismaFileUrl(liveDbPath),
    },
  },
});

const source = await backup.shopSettings.findUnique({ where: { shop } });
if (!source) {
  throw new Error(`ShopSettings not found in backup for shop=${shop}`);
}

await live.shopSettings.upsert({
  where: { shop },
  create: {
    id: source.id,
    shop: source.shop,
    apiBaseUrl: source.apiBaseUrl,
    apiKey: source.apiKey,
    webhookSecret: source.webhookSecret,
    merchantLabel: source.merchantLabel,
    mode: source.mode,
    createdAt: source.createdAt,
  },
  update: {
    apiBaseUrl: source.apiBaseUrl,
    apiKey: source.apiKey,
    webhookSecret: source.webhookSecret,
    merchantLabel: source.merchantLabel,
    mode: source.mode,
  },
});

const restored = await live.shopSettings.findUnique({ where: { shop } });
await backup.$disconnect();
await live.$disconnect();

console.log(`Restored ShopSettings for ${shop}`);
console.log(
  `apiBaseUrl=${restored.apiBaseUrl} merchantLabel=${restored.merchantLabel} mode=${restored.mode} apiKeyLength=${restored.apiKey.length} webhookSecretLength=${restored.webhookSecret.length}`,
);
