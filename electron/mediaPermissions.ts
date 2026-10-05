import type { Session, WebContents } from "electron";
import { isTrustedLocalRendererUrl } from "./desktopModePolicy.js";

/** Camera consent belongs to one trusted main renderer, never to its session's popups. */
export function installCameraPermissions(
  hostedSession: Session,
  mainContents: WebContents,
  renderer: { kind: "hosted"; origin: string } | { kind: "local"; devOrigin?: string },
  requestConsent: () => Promise<boolean>,
  isRendererActive: () => boolean = () => true,
) {
  let active = true;
  let granted = false;
  let generation = 0;
  let prompting: Promise<boolean> | undefined;
  const pending = new Set<(allowed: boolean) => void>();
  const exactOrigin = (url?: string) => {
    if (renderer.kind === "local") return isTrustedLocalRendererUrl(url ?? "", renderer.devOrigin);
    try {
      const target = new URL(url ?? "");
      return target.protocol === "https:" && !target.username && !target.password && target.origin === renderer.origin;
    } catch { return false; }
  };
  const ownedMainFrame = (contents: WebContents | null, mainFrame: boolean, url?: string, securityOrigin?: string) =>
    active && isRendererActive() && contents === mainContents && !mainContents.isDestroyed() && mainFrame &&
    exactOrigin(mainContents.getURL()) && exactOrigin(url) && (!securityOrigin || exactOrigin(securityOrigin));
  const cancelPending = () => {
    generation += 1;
    granted = false;
    prompting = undefined;
    for (const callback of [...pending]) callback(false);
  };
  mainContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) cancelPending();
  });
  mainContents.once("destroyed", () => { active = false; cancelPending(); });
  hostedSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if ((!requestingOrigin || exactOrigin(requestingOrigin)) &&
        ownedMainFrame(contents, details.isMainFrame, details.requestingUrl, details.securityOrigin)) {
      // Copy controls may write their own text; reading the user's clipboard is
      // a separate permission and remains denied, as do popups and subframes.
      return permission === "clipboard-sanitized-write" || (permission === "media" && details.mediaType === "video" && granted);
    }
    return false;
  });
  hostedSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    let settled = false;
    const settle = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      pending.delete(settle);
      callback(allowed);
    };
    if (permission === "clipboard-sanitized-write" && ownedMainFrame(contents, details.isMainFrame, details.requestingUrl)) {
      settle(true);
      return;
    }
    const media = "mediaTypes" in details ? details : undefined;
    if (permission !== "media" || media?.mediaTypes?.length !== 1 || media.mediaTypes[0] !== "video" ||
        !ownedMainFrame(contents, details.isMainFrame, details.requestingUrl, media.securityOrigin)) {
      settle(false);
      return;
    }
    if (granted) { settle(true); return; }
    pending.add(settle);
    const current = generation;
    if (!prompting) prompting = requestConsent().catch(() => false);
    const consent = prompting;
    void consent.then((allowed) => {
      const stillOwned = current === generation &&
        ownedMainFrame(contents, details.isMainFrame, details.requestingUrl, media.securityOrigin);
      if (allowed && stillOwned) granted = true;
      settle(allowed && stillOwned);
    }).finally(() => { if (prompting === consent) prompting = undefined; });
  });
  return Object.assign(() => { active = false; cancelPending(); }, { reset: cancelPending });
}
