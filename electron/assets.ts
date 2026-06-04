import { access } from "node:fs/promises";
import path from "node:path";

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

export function getResourcePathCandidates(dirname: string, fileName: string) {
  return [
    path.resolve(dirname, "../../assets/electron", fileName),
    path.resolve(process.resourcesPath, fileName),
    path.resolve(process.resourcesPath, "assets/electron", fileName),
  ];
}

export async function resolveResourcePath(dirname: string, fileName: string) {
  for (const candidate of getResourcePathCandidates(dirname, fileName)) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function getIconPaths(dirname: string): Promise<DesktopIconPaths> {
  const [png, icns, ico] = await Promise.all([
    resolveResourcePath(dirname, "icon.png"),
    resolveResourcePath(dirname, "icon.icns"),
    resolveResourcePath(dirname, "icon.ico"),
  ]);
  return { png, icns, ico };
}
