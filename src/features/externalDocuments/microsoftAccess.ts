import type { IPublicClientApplication } from "@azure/msal-browser";
import { isLocalDataRuntime } from "@/lib/staticRuntime";
import { appRouteAbsoluteHref } from "@/lib/appRouteHref";

type SourceForAuthentication = {
  id?: string;
  _id?: string;
  enabled?: boolean;
  providerId?: string;
  config: { tenantId: string; clientId: string };
};

const scopes = [
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Sites.Selected",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clients = new Map<string, Promise<IPublicClientApplication>>();
let societyerSession: string | null = null;
let generation = 0;

/** Called by the app's authenticated session boundary, including direct Clerk sign-out. */
export function setDocumentSourceSessionKey(value: string | null): void {
  if (societyerSession === value) return;
  societyerSession = value;
  void forgetDocumentSourceAccounts();
}

/** Disconnect this tab's Microsoft accounts without changing the Societyer login. */
export async function forgetDocumentSourceAccounts(): Promise<void> {
  generation += 1;
  const previous = [...clients.values()];
  clients.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("societyer:document-source-accounts-cleared"));
  await Promise.all(previous.map(async (pending) => {
    try { await (await pending).clearCache(); } catch { /* No credentials are persisted by this module. */ }
  }));
}

function assertAvailable(source: SourceForAuthentication): void {
  if (isLocalDataRuntime()) throw new Error("Microsoft document access requires a hosted workspace. Local source settings can be prepared without connecting.");
  if (typeof window === "undefined" || !window.isSecureContext) throw new Error("Microsoft document access requires a secure browser connection.");
  if (!navigator.onLine) throw new Error("Connect to the internet before opening the document source.");
  if (!societyerSession) throw new Error("Sign in to Societyer before connecting a document source.");
  if (source.enabled === false) throw new Error("This document source is disabled.");
  if (source.providerId && source.providerId !== "microsoft-sharepoint") throw new Error("This document source does not support Microsoft sign-in.");
  if (!uuid.test(source.config.tenantId) || !uuid.test(source.config.clientId)) throw new Error("The document source needs a valid Microsoft tenant and application ID.");
}

async function clientFor(source: SourceForAuthentication): Promise<IPublicClientApplication> {
  const tenantId = source.config.tenantId.toLowerCase();
  const clientId = source.config.clientId.toLowerCase();
  const key = `${societyerSession}:${tenantId}:${clientId}`;
  let pending = clients.get(key);
  if (!pending) {
    pending = (async () => {
      // Loading the Microsoft SDK is an explicit connector action, not an app startup dependency.
      const { PublicClientApplication, BrowserCacheLocation } = await import("@azure/msal-browser");
      const client = new PublicClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${tenantId}`,
          redirectUri: appRouteAbsoluteHref("/document-source-auth.html"),
        },
        cache: { cacheLocation: BrowserCacheLocation.MemoryStorage },
        system: {
          allowPlatformBroker: false,
          loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => undefined },
        },
      });
      await client.initialize();
      return client;
    })();
    clients.set(key, pending);
    pending.catch(() => { if (clients.get(key) === pending) clients.delete(key); });
  }
  return pending;
}

/**
 * Acquire a delegated token only for a user-initiated connector operation.
 * Tokens live in the SDK's memory cache and the authenticated action request;
 * they never enter source settings, document rows, local queues, or app logs.
 * The backend independently checks Societyer access and Graph resource access.
 */
export async function acquireDocumentSourceToken(
  source: SourceForAuthentication,
  options: { interactive?: boolean } = {},
): Promise<string> {
  assertAvailable(source);
  const startedAt = generation;
  const assertSameSession = () => {
    if (startedAt !== generation || !societyerSession) throw new Error("Your session changed. Connect the document source again.");
  };
  try {
    const client = await clientFor(source);
    assertSameSession();
    const account = client.getActiveAccount();
    let response;
    if (account && account.tenantId.toLowerCase() === source.config.tenantId.toLowerCase()) {
      try { response = await client.acquireTokenSilent({ scopes, account }); }
      catch { /* A user gesture may be needed for expired consent or Conditional Access. */ }
    }
    assertSameSession();
    if (!response) {
      if (options.interactive === false) throw new Error("DOCUMENT_SOURCE_SIGN_IN_REQUIRED");
      response = await client.acquireTokenPopup({ scopes, ...(account ? { account } : { prompt: "select_account" }) });
    }
    assertSameSession();
    if (!response.account || response.tenantId.toLowerCase() !== source.config.tenantId.toLowerCase() || !response.accessToken) {
      throw new Error("DOCUMENT_SOURCE_WRONG_TENANT");
    }
    client.setActiveAccount(response.account);
    return response.accessToken;
  } catch (error: unknown) {
    assertSameSession();
    // MSAL/server error details may contain account identifiers or URLs. Keep these out of toasts/logs.
    const code = typeof error === "object" && error ? String((error as { errorCode?: string }).errorCode ?? "") : "";
    if (code === "user_cancelled") throw new Error("Microsoft sign-in was cancelled. The document source was not opened.");
    if (code === "popup_window_error" || code === "empty_window_error") throw new Error("Allow Microsoft sign-in popups for this site, then try again.");
    if (error instanceof Error && error.message === "DOCUMENT_SOURCE_WRONG_TENANT") throw new Error("Use an account with access to the configured Microsoft tenant.");
    throw new Error("Microsoft document sign-in could not finish. Check the source's SPA callback, selected-site read grant, and your access, then try again.");
  }
}
