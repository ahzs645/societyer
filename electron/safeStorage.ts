import { app, safeStorage } from "electron";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type DesktopSecretKey =
  | "connector-token"
  | "rustfs-access-key"
  | "rustfs-secret-key"
  | "ai-api-key"
  | "sync-token";

const SECRET_KEYS = new Set<DesktopSecretKey>([
  "connector-token",
  "rustfs-access-key",
  "rustfs-secret-key",
  "ai-api-key",
  "sync-token",
]);

export function isSafeStorageAvailable() {
  return safeStorage.isEncryptionAvailable();
}

export function encryptSecret(value: string) {
  if (!isSafeStorageAvailable()) {
    throw new Error("Electron safeStorage encryption is not available.");
  }
  return safeStorage.encryptString(value).toString("base64");
}

export function decryptSecret(value: string) {
  if (!isSafeStorageAvailable()) {
    throw new Error("Electron safeStorage encryption is not available.");
  }
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function assertSecretKey(key: string): asserts key is DesktopSecretKey {
  if (!SECRET_KEYS.has(key as DesktopSecretKey)) {
    throw new Error("Unsupported desktop secret key.");
  }
}

function secretStorePath() {
  return path.join(app.getPath("userData"), "desktop-secrets.json");
}

async function readSecretStore(): Promise<Partial<Record<DesktopSecretKey, string>>> {
  try {
    return JSON.parse(await readFile(secretStorePath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeSecretStore(store: Partial<Record<DesktopSecretKey, string>>) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(secretStorePath(), JSON.stringify(store, null, 2));
}

export async function setDesktopSecret(key: string, value: string) {
  assertSecretKey(key);
  const trimmed = value.trim();
  if (!trimmed) {
    await removeDesktopSecret(key);
    return { stored: false };
  }

  const store = await readSecretStore();
  store[key] = encryptSecret(trimmed);
  await writeSecretStore(store);
  return { stored: true };
}

export async function getDesktopSecret(key: string) {
  assertSecretKey(key);
  const store = await readSecretStore();
  const encrypted = store[key];
  if (!encrypted) return null;
  return decryptSecret(encrypted);
}

export async function removeDesktopSecret(key: string) {
  assertSecretKey(key);
  const store = await readSecretStore();
  delete store[key];
  if (Object.keys(store).length === 0) {
    await unlink(secretStorePath()).catch(() => undefined);
    return { stored: false };
  }
  await writeSecretStore(store);
  return { stored: false };
}
