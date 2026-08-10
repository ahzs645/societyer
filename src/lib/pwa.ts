import { getRuntimeMode } from "./runtimeMode";

export function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

export function isPwaLaunch() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("pwa") === "1" || params.get("source") === "pwa" || isStandalonePwa();
}

/**
 * iOS Safari never fires `beforeinstallprompt`, so "Add to Home Screen" can
 * only be described, not triggered. Detect it to show instructions instead of
 * a button that would do nothing.
 */
export function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iOS && webkit;
}

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_PROMPT_EVENT = "societyer:install-availability";

let deferredInstallPrompt: InstallPromptEvent | null = null;

export function getDeferredInstallPrompt() {
  return deferredInstallPrompt;
}

export function subscribeToInstallAvailability(listener: () => void) {
  window.addEventListener(INSTALL_PROMPT_EVENT, listener);
  return () => window.removeEventListener(INSTALL_PROMPT_EVENT, listener);
}

/**
 * Chrome fires `beforeinstallprompt` once, early, and only if the page is
 * installable. Capture it at startup so an "Install" button rendered later can
 * still trigger the real prompt — the event is not re-dispatched on demand.
 */
export function captureInstallPrompt() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as InstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
  });
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredInstallPrompt;
  if (!event) return "unavailable";
  await event.prompt();
  const { outcome } = await event.userChoice;
  // The captured event is single-use; Chrome fires a fresh one if the user
  // dismisses and the page stays installable.
  deferredInstallPrompt = null;
  window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
  return outcome;
}

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;
  // Electron loads the build from file:// where service workers are both
  // unavailable and pointless — the whole app is already on disk.
  if (getRuntimeMode() === "electron-local") return;

  // Register relative to the deployed base path so a build served from a
  // subdirectory registers its own worker with its own scope, instead of
  // asking for a /sw.js that isn't there.
  const base = import.meta.env.BASE_URL || "/";
  const scriptUrl = new URL(`${base}sw.js`.replace(/\/{2,}/g, "/"), window.location.origin);

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(scriptUrl.pathname, { scope: base }).catch((error) => {
      console.warn("Societyer service worker registration failed", error);
    });
  });
}
