#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { copyFile, mkdir, chmod, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDbPath = path.join(repoRoot, "prisma", "dev.sqlite");
const defaultBackupRoot = path.join(repoRoot, "backups", "shopify-reinstall");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function prismaFileUrl(dbPath) {
  return `file:${path.resolve(dbPath)}`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function sha256(filePath) {
  const { readFile } = await import("fs/promises");
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

const sourceDbPath = path.resolve(argValue("--db", defaultDbPath));
const backupRoot = path.resolve(argValue("--out-dir", defaultBackupRoot));
const shop = argValue("--shop", undefined);

if (!existsSync(sourceDbPath)) {
  throw new Error(`SQLite DB not found: ${sourceDbPath}`);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: prismaFileUrl(sourceDbPath),
    },
  },
});

const backupDir = path.join(backupRoot, timestamp());
await mkdir(backupDir, { recursive: true, mode: 0o700 });
await chmod(backupDir, 0o700);

const filesToCopy = [
  sourceDbPath,
  `${sourceDbPath}-wal`,
  `${sourceDbPath}-shm`,
].filter((filePath) => existsSync(filePath));

const copiedFiles = [];
for (const filePath of filesToCopy) {
  const destination = path.join(backupDir, path.basename(filePath));
  await copyFile(filePath, destination);
  await chmod(destination, 0o600);
  const fileStat = await stat(destination);
  copiedFiles.push({
    source: filePath,
    destination,
    bytes: fileStat.size,
    sha256: await sha256(destination),
  });
}

const whereShop = shop ? { shop } : {};
const [sessionCount, shopSettingsCount, orderMappingCount, pendingCount, paidCount, settings] =
  await Promise.all([
    prisma.session.count(),
    prisma.shopSettings.count({ where: whereShop }),
    prisma.orderMapping.count({ where: whereShop }),
    prisma.orderMapping.count({ where: { ...whereShop, status: "pending" } }),
    prisma.orderMapping.count({ where: { ...whereShop, status: "paid" } }),
    prisma.shopSettings.findMany({
      where: whereShop,
      select: {
        shop: true,
        apiBaseUrl: true,
        merchantLabel: true,
        mode: true,
        apiKey: true,
        webhookSecret: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { shop: "asc" },
    }),
  ]);

const manifest = {
  createdAt: new Date().toISOString(),
  sourceDbPath,
  backupDir,
  shop: shop ?? null,
  copiedFiles,
  counts: {
    sessions: sessionCount,
    shopSettings: shopSettingsCount,
    orderMappings: orderMappingCount,
    pendingOrderMappings: pendingCount,
    paidOrderMappings: paidCount,
  },
  shopSettings: settings.map((row) => ({
    shop: row.shop,
    apiBaseUrl: row.apiBaseUrl,
    merchantLabel: row.merchantLabel,
    mode: row.mode,
    hasApiKey: Boolean(row.apiKey),
    apiKeyLength: row.apiKey?.length ?? 0,
    hasWebhookSecret: Boolean(row.webhookSecret),
    webhookSecretLength: row.webhookSecret?.length ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })),
};

const manifestPath = path.join(backupDir, "manifest.redacted.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await chmod(manifestPath, 0o600);

await prisma.$disconnect();

console.log(`Backup created: ${backupDir}`);
console.log(`Manifest: ${manifestPath}`);
console.log(
  `Counts: sessions=${sessionCount} shopSettings=${shopSettingsCount} orderMappings=${orderMappingCount} pending=${pendingCount} paid=${paidCount}`,
);
