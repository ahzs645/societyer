import { safeStorage } from "electron";

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
