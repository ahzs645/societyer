import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const DEV_USER_DATA_DIR = "Societyer Desktop Dev";
const PACKAGED_USER_DATA_DIR = "Societyer Desktop";
const LEGACY_USER_DATA_DIRS = ["societyer", "Societyer"];

export type UserDataMigrationResult = {
  userDataPath: string;
  migratedFrom?: string;
};

export function configureUserDataPath(isDev: boolean): UserDataMigrationResult {
  const appDataPath = app.getPath("appData");
  const userDataPath = path.join(appDataPath, isDev ? DEV_USER_DATA_DIR : PACKAGED_USER_DATA_DIR);
  const migratedFrom = migrateLegacyUserDataIfNeeded(appDataPath, userDataPath);
  app.setPath("userData", userDataPath);
  return migratedFrom ? { userDataPath, migratedFrom } : { userDataPath };
}

function migrateLegacyUserDataIfNeeded(appDataPath: string, userDataPath: string) {
  if (directoryHasEntries(userDataPath)) return undefined;
  const legacyPath = LEGACY_USER_DATA_DIRS
    .map((dirName) => path.join(appDataPath, dirName))
    .find((candidate) => candidate !== userDataPath && directoryHasEntries(candidate));
  if (!legacyPath) return undefined;

  mkdirSync(userDataPath, { recursive: true });
  cpSync(legacyPath, userDataPath, {
    recursive: true,
    errorOnExist: false,
    force: false,
  });
  return legacyPath;
}

function directoryHasEntries(directory: string) {
  try {
    return existsSync(directory) && readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}
