import { access } from "node:fs/promises";
import path from "node:path";
import type { DesktopEnvironment } from "./environment.js";

export type DesktopIconPaths = {
  png: string | null;
  icns: string | null;
  ico: string | null;
};

export async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getResourcePathCandidates(environment: DesktopEnvironment, fileName: string) {
  return [
    path.resolve(environment.dirname, "../../assets/electron", fileName),
    path.resolve(environment.resourcesPath, fileName),
    path.resolve(environment.resourcesPath, "assets/electron", fileName),
  ];
}

export async function resolveResourcePath(environment: DesktopEnvironment, fileName: string) {
  for (const candidate of getResourcePathCandidates(environment, fileName)) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function getIconPaths(environment: DesktopEnvironment): Promise<DesktopIconPaths> {
  const [png, icns, ico] = await Promise.all([
    resolveResourcePath(environment, "icon.png"),
    resolveResourcePath(environment, "icon.icns"),
    resolveResourcePath(environment, "icon.ico"),
  ]);
  return { png, icns, ico };
}
