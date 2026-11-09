import { loadSessionAuthClient } from "../lib/sessionAuthClient";
import { authFailureFromResponse } from "./authErrors";

/** Absolute app URL on this origin; the auth server is on another one. */
export function appUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return new URL(`${basePath}${path}`, window.location.origin).href;
}

/**
 * Sends the browser to Microsoft and back to `redirect` on this origin. A
 * failure returns to `/login?redirect=…&sso=failed` unless `errorRedirect` is given.
 */
export async function startMicrosoftSignIn({ redirect, errorRedirect }: { redirect: string; errorRedirect?: string }) {
  const { authClient } = await loadSessionAuthClient();
  const failed = new URL(appUrl("/login"));
  failed.searchParams.set("redirect", redirect);
  failed.searchParams.set("sso", "failed");
  const result = await authClient.signIn.social({
    provider: "microsoft",
    callbackURL: appUrl(redirect),
    errorCallbackURL: errorRedirect ? appUrl(errorRedirect) : failed.href,
  });
  if (result.error) throw authFailureFromResponse(result.error, "Microsoft sign-in failed. Please try again.");
}
