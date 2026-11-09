import { useCallback, useState, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AuthPending, AuthShell } from "../../auth/AuthShell";

/**
 * Shared entry for the personal account pages (convex mode only). `gate` is
 * what to render instead of the page: a redirect, or a pending state.
 * `signOutTo` signs out and then goes to `target`, without the signed-out
 * redirect racing it.
 */
export function useAccountPage(title: string, path: string, signedOutTarget?: string) {
  const auth = useAuth();
  const [leaving, setLeaving] = useState<string | null>(null);
  const signOutTo = useCallback(async (target: string) => {
    setLeaving(target);
    try {
      await auth.signOut();
    } catch (error) {
      console.error("[societyer-auth] sign-out failed", error);
      setLeaving(null);
    }
  }, [auth]);

  let gate: ReactElement | null = null;
  if (auth.mode !== "convex") gate = <Navigate to="/app" replace />;
  else if (leaving) gate = auth.session ? <AccountPending title={title}>Signing out…</AccountPending> : <Navigate to={leaving} replace />;
  else if (auth.sessionStatus === "loading") gate = <AccountPending title={title}>Checking your session…</AccountPending>;
  else if (!auth.session) gate = <Navigate to={signedOutTarget ?? `/login?redirect=${encodeURIComponent(path)}`} replace />;
  return { gate, signOutTo };
}

export function AccountPending({ title, children }: { title: string; children: string }) {
  return <AuthShell title={title}><AuthPending>{children}</AuthPending></AuthShell>;
}

/** `/login` for the second account of a link, coming back to the confirm page. */
export const LINK_SIGN_IN_PATH = `/login?linkAccount=1&redirect=${encodeURIComponent("/account/link/confirm")}`;
