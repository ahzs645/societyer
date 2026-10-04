import { ClerkProvider, useAuth as useClerkAuth, useUser } from "@clerk/react";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AuthenticatedProviderReady, type AuthSession } from "./AuthProvider";

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
  const { isLoaded, isSignedIn, getToken: getClerkToken, signOut: clerkSignOut } = useClerkAuth({ treatPendingAsSignedOut: true });
  const { isLoaded: userLoaded, user } = useUser();
  const userId = user?.id;
  const name = user?.fullName ?? user?.username ?? "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const session = useMemo<AuthSession | null>(() => {
    if (!isSignedIn || !userId) return null;
    return { user: { id: userId, name, email } };
  }, [isSignedIn, userId, name, email]);
  const getToken = useCallback((forceRefresh = false) => getClerkToken({
    template: import.meta.env.VITE_CLERK_JWT_TEMPLATE || "convex",
    skipCache: forceRefresh,
  }), [getClerkToken]);
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
