import { app, BrowserWindow, dialog, session, type Event, type Session } from "electron";
import { createHash } from "node:crypto";
import { readDesktopConfig, updateDesktopConfig } from "./config.js";
import { isAllowedHostedNavigation, normalizeHostedConfiguration, type HostedDesktopConfiguration } from "./desktopModePolicy.js";
import { openExternal } from "./shell.js";
import type { DesktopModeState } from "../src/lib/desktopBridge";

let localWindow: (() => Promise<BrowserWindow>) | undefined;
let hostedWindow: BrowserWindow | undefined;
const signInWindows = new Set<BrowserWindow>();
let quitting = false;
let attempt = 0;
let lastError: string | undefined;
let opening: Promise<DesktopModeState> | undefined;
const networking = new WeakMap<Session, { enabled: boolean }>();

function setHostedNetworking(hostedSession: Session, enabled: boolean) {
  let policy = networking.get(hostedSession);
  if (!policy) {
    policy = { enabled };
    networking.set(hostedSession, policy);
    const current = policy;
    hostedSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (_details, callback) => callback({ cancel: !current.enabled }));
  }
  policy.enabled = enabled;
  if (enabled) hostedSession.disableNetworkEmulation();
  else hostedSession.enableNetworkEmulation({ offline: true });
}

export function configureDesktopModes(getLocalWindow: () => Promise<BrowserWindow>) {
  localWindow = getLocalWindow;
  app.on("before-quit", () => { quitting = true; attempt += 1; });
}

export async function getDesktopModeState(): Promise<DesktopModeState> {
  const config = await readDesktopConfig();
  return {
    mode: hostedWindow && !hostedWindow.isDestroyed() && hostedWindow.isVisible() ? "online" : "local",
    startupMode: config.desktopMode === "online" && config.hostedApplication ? "online" : "local",
    hostedApplication: config.hostedApplication ?? null,
    ...(lastError ? { lastError } : {}),
  };
}

export async function returnToLocalMode(): Promise<DesktopModeState> {
  const localAttempt = ++attempt;
  const previous = hostedWindow;
  hostedWindow = undefined;
  const previousSession = previous && !previous.isDestroyed() ? previous.webContents.session : undefined;
  if (previousSession) setHostedNetworking(previousSession, false);
  for (const window of signInWindows) window.destroy();
  // Closing the renderer terminates existing WebSockets, which session network
  // emulation alone does not stop. Durable hosted storage stays in its partition.
  if (previous && !previous.isDestroyed()) previous.destroy();
  if (previousSession) {
    await previousSession.closeAllConnections();
  }
  await updateDesktopConfig({ desktopMode: "local" });
  if (!quitting && localWindow && localAttempt === attempt) {
    const window = await localWindow();
    if (localAttempt !== attempt) return getDesktopModeState();
    window.show();
    window.focus();
  }
  return getDesktopModeState();
}

export function openHostedMode(configuration?: HostedDesktopConfiguration): Promise<DesktopModeState> {
  if (opening) return opening;
  opening = loadHostedMode(configuration).finally(() => { opening = undefined; });
  return opening;
}

async function loadHostedMode(configuration?: HostedDesktopConfiguration): Promise<DesktopModeState> {
  const config = await readDesktopConfig();
  const next = configuration ? normalizeHostedConfiguration(configuration) : config.hostedApplication;
  if (!next) throw new Error("Configure your HTTPS Societyer web app in Desktop setup first.");
  if (!localWindow) throw new Error("Desktop modes have not been initialized.");
  const currentAttempt = ++attempt;
  lastError = undefined;
  if (hostedWindow && !hostedWindow.isDestroyed() &&
      JSON.stringify(next) === JSON.stringify(config.hostedApplication)) {
    setHostedNetworking(hostedWindow.webContents.session, true);
    await updateDesktopConfig({ desktopMode: "online" });
    const local = await localWindow();
    if (currentAttempt !== attempt) return getDesktopModeState();
    hostedWindow.show();
    hostedWindow.focus();
    local.hide();
    return getDesktopModeState();
  }
  const previous = hostedWindow;
  hostedWindow = undefined;
  if (previous && !previous.isDestroyed()) {
    const previousSession = previous.webContents.session;
    setHostedNetworking(previousSession, false);
    previous.destroy();
    await previousSession.closeAllConnections();
  }
  for (const window of signInWindows) window.destroy();
  await updateDesktopConfig({ hostedApplication: next, desktopMode: "local" });
  if (currentAttempt !== attempt) return getDesktopModeState();
  const partition = `persist:societyer-hosted-${createHash("sha256").update(next.origin).digest("hex").slice(0, 24)}`;
  const hostedSession = session.fromPartition(partition);
  setHostedNetworking(hostedSession, true);
  hostedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  hostedSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    title: "Societyer — Online workspace",
    width: 1320, height: 900, minWidth: 360, minHeight: 480,
    show: false,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  hostedWindow = window;
  hardenHostedWindow(window, next, partition);
  window.on("closed", () => {
    if (hostedWindow !== window) return;
    hostedWindow = undefined;
    setHostedNetworking(hostedSession, false);
    const closedAttempt = attempt;
    for (const child of signInWindows) child.destroy();
    void hostedSession.closeAllConnections().then(() => {
      if (!quitting && !hostedWindow && closedAttempt === attempt) return returnToLocalMode();
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      window.loadURL(`${next.origin}/app`),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Hosted application timed out.")), 15_000);
      }),
    ]);
    if (currentAttempt !== attempt || window.isDestroyed()) return getDesktopModeState();
    await updateDesktopConfig({ desktopMode: "online" });
    const local = await localWindow();
    if (currentAttempt !== attempt || window.isDestroyed()) return getDesktopModeState();
    window.show();
    window.focus();
    local.hide();
    return getDesktopModeState();
  } catch {
    if (currentAttempt !== attempt) return getDesktopModeState();
    lastError = "The online workspace could not load. Your local workspace remains available; reconnect and try again.";
    hostedWindow = undefined;
    setHostedNetworking(hostedSession, false);
    if (!window.isDestroyed()) window.destroy();
    await hostedSession.closeAllConnections();
    await returnToLocalMode();
    throw new Error(lastError);
  } finally { if (timer) clearTimeout(timer); }
}

function hardenHostedWindow(window: BrowserWindow, configuration: HostedDesktopConfiguration, partition: string) {
  const guard = (event: Event, url: string) => {
    if (isAllowedHostedNavigation(url, configuration)) return;
    event.preventDefault();
    // Never send unknown OAuth redirects or codes to an unrelated application automatically.
    void dialog.showMessageBox(window, {
      type: "warning", message: "Navigation outside the configured app and sign-in origins was blocked.",
      detail: "Add the exact HTTPS sign-in origin in Desktop setup if your identity provider requires it.",
    });
  };
  window.webContents.on("will-navigate", guard);
  window.webContents.on("will-redirect", guard);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedHostedNavigation(url, configuration)) {
      // Only explicit ordinary links may leave the isolated application. OAuth callbacks stay inside.
      try {
        const target = new URL(url);
        if ((target.protocol === "https:" || target.protocol === "mailto:") &&
            !target.search && !target.hash && !target.username && !target.password) void openExternal(url);
      } catch { /* Invalid popup URL is denied. */ }
      return { action: "deny" };
    }
    return { action: "allow", overrideBrowserWindowOptions: {
      parent: window, width: 560, height: 780,
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
    } };
  });
  window.webContents.on("did-create-window", (child) => {
    signInWindows.add(child);
    hardenHostedWindow(child, configuration, partition);
    child.once("closed", () => signInWindows.delete(child));
  });
  // Subframes cannot invoke native IPC; web permissions are denied at the session boundary.
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

export async function resumeDesktopMode() {
  const config = await readDesktopConfig();
  if (config.desktopMode !== "online" || !config.hostedApplication) return;
  try { await openHostedMode(); } catch { /* Offline startup returns to the bundled local workspace. */ }
}

export async function openHostedModeFromMenu() {
  try { await openHostedMode(); } catch (error) {
    await returnToLocalMode();
    await dialog.showMessageBox({ type: "info", message: error instanceof Error ? error.message : "Online workspace unavailable." });
  }
}
