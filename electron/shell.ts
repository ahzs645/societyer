import type { BrowserWindow } from "electron";
import { shell } from "electron";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function parseSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;

  try {
    const url = new URL(rawUrl);
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function openExternal(rawUrl: unknown) {
  const externalUrl = parseSafeExternalUrl(rawUrl);
  if (!externalUrl) return false;
  await shell.openExternal(externalUrl);
  return true;
}

export async function openPath(filePath: string) {
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
}

export function hardenWindowNavigation(window: BrowserWindow, allowedAppOrigins: string[]) {
  const allowedOrigins = new Set(allowedAppOrigins);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const origin = getOrigin(url);
    if (origin && allowedOrigins.has(origin)) return;

    event.preventDefault();
    void openExternal(url);
  });
}

function getOrigin(rawUrl: string) {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}
