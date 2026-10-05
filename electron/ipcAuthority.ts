import type { IpcMainInvokeEvent, WebContents } from "electron";
import { isTrustedLocalRendererUrl } from "./desktopModePolicy.js";

const trustedContents = new Map<number, string | undefined>();

export function registerLocalRendererAuthority(contents: WebContents, devOrigin?: string) {
  trustedContents.set(contents.id, devOrigin);
  contents.once("destroyed", () => trustedContents.delete(contents.id));
}

export function isRegisteredLocalRenderer(contents: WebContents) {
  return trustedContents.has(contents.id) &&
    isTrustedLocalRendererUrl(contents.getURL(), trustedContents.get(contents.id));
}

export function assertLocalRendererAuthority(event: IpcMainInvokeEvent) {
  if (!trustedContents.has(event.sender.id) || !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedLocalRendererUrl(event.senderFrame.url, trustedContents.get(event.sender.id)) ||
      !isTrustedLocalRendererUrl(event.sender.getURL(), trustedContents.get(event.sender.id))) {
    throw new Error("Native workspace access is restricted to the local desktop application.");
  }
}
