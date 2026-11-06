import { ClerkProvider, useAuth as useClerkAuth, useUser } from "@clerk/react";
import { useCallback, useMemo, useRef } from "react";
import { decodeJwt } from "jose";
import { useNavigate } from "react-router-dom";
import { AuthenticatedProviderReady, type AuthSession } from "./AuthProvider";
import { convexAuthSiteUrl } from "../lib/convexSite";
import { CLERK_MFA_PROOF_REFRESH_MS, CLERK_MFA_SESSION_PATH, clerkSecondFactorVerified } from "../../shared/workspaceMfa";

export default function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  const loginUrl = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}login`;
  if (!publishableKey) {
    return (
      <div className="page" role="alert">
        <h1>Sign-in unavailable</h1>
        <p>Sign-in has not been configured. Contact your workspace administrator.</p>
      </div>
    );
  }
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl={loginUrl}
      signUpUrl={`${loginUrl}?mode=sign-up`}
      afterSignOutUrl={loginUrl}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      <ClerkSessionProvider>{children}</ClerkSessionProvider>
    </ClerkProvider>
  );
}

function ClerkSessionProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, sessionId, getToken: getClerkToken, signOut: clerkSignOut } = useClerkAuth({ treatPendingAsSignedOut: true });
  const { isLoaded: userLoaded, user } = useUser();
  const userId = user?.id;
  const name = user?.fullName ?? user?.username ?? "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const session = useMemo<AuthSession | null>(() => {
    if (!isSignedIn || !userId) return null;
    return { user: { id: userId, name, email }, session: sessionId ? { id: sessionId } : undefined };
  }, [isSignedIn, userId, name, email, sessionId]);
  const proofRef = useRef<{ sessionId: string; registeredAt: number } | null>(null);
  const getToken = useCallback(async (forceRefresh = false) => {
    const template = import.meta.env.VITE_CLERK_JWT_TEMPLATE;
    if (template) return getClerkToken({ template, skipCache: forceRefresh });

    const token = await getClerkToken({ skipCache: forceRefresh });
    const payload = token ? decodeJwt(token) : null;
    // Keep the identity claims the legacy Convex template supplied for email invitations.
    if (!token || !payload || typeof payload.email_verified !== "boolean" ||
        (email && typeof payload.email !== "string") ||
        !(payload.aud === "convex" || (Array.isArray(payload.aud) && payload.aud.includes("convex")))) {
      return getClerkToken({ template: "convex", skipCache: forceRefresh });
    }
    const proof = proofRef.current;
    if (sessionId && payload.sid === sessionId && clerkSecondFactorVerified(payload.fva) &&
        (proof?.sessionId !== sessionId || Date.now() - proof.registeredAt >= CLERK_MFA_PROOF_REFRESH_MS)) {
      try {
        const response = await fetch(`${convexAuthSiteUrl()}${CLERK_MFA_SESSION_PATH}`, {
          method: "POST",
          credentials: "omit",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(4000),
        });
        if (response.status === 204) proofRef.current = { sessionId, registeredAt: Date.now() };
      } catch {
        // Workspaces with Optional 2FA still work, and the next token refresh retries.
      }
    }
    return token;
  }, [getClerkToken, sessionId, email]);
  const signOut = useCallback(async () => { await clerkSignOut(); }, [clerkSignOut]);

  return (
    <AuthenticatedProviderReady
      mode="clerk"
      session={session}
      sessionPending={!isLoaded || !userLoaded}
      getToken={getToken}
      providerSignOut={signOut}
    >
      {children}
    </AuthenticatedProviderReady>
  );
}
