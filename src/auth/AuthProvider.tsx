import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useConvex, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { getAuthMode, type AuthMode } from "../lib/authMode";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";

type AuthClient = typeof import("../lib/authClient").authClient;
type BetterAuthSession = AuthClient["$Infer"]["Session"];

type AuthContextValue = {
  mode: AuthMode;
  session: BetterAuthSession | null;
  isPending: boolean;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const mode = getAuthMode();

  if (mode !== "better-auth" || isLocalDataRuntime()) {
    return <NoAuthProvider mode="none">{children}</NoAuthProvider>;
  }

  return <BetterAuthProvider mode={mode}>{children}</BetterAuthProvider>;
}

function NoAuthProvider({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: AuthMode;
}) {
  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      session: null,
      isPending: false,
      isAuthenticated: true,
      signOut: async () => {
        setStoredUserId(null);
      },
    }),
    [mode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function BetterAuthProvider({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: AuthMode;
}) {
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setAuthClient(null);
    setLoadError(false);
    import("../lib/authClient")
      .then((module) => {
        if (active) setAuthClient(module.authClient);
      })
      .catch((error) => {
        console.error("[societyer-auth] failed to load auth client", error);
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  if (!authClient) {
    if (loadError) {
      return (
        <div className="page">
          <p>Authentication could not be loaded.</p>
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </button>
        </div>
      );
    }
    return <div className="page">Authorizing…</div>;
  }

  return (
    <BetterAuthProviderReady authClient={authClient} mode={mode}>
      {children}
    </BetterAuthProviderReady>
  );
}

function BetterAuthProviderReady({
  authClient,
  children,
  mode,
}: {
  authClient: AuthClient;
  children: React.ReactNode;
  mode: AuthMode;
}) {
  const sessionState = authClient.useSession();
  const session = sessionState.data;
  const authUser = session?.user;
  const convex = useConvex();
  const society = useSociety();
  const resolveAuthSession = useMutation(api.users.resolveAuthSession);
  const syncKeyRef = useRef<string | null>(null);
  const [syncPending, setSyncPending] = useState(false);

  useEffect(() => {
    if (mode !== "better-auth" || !session) {
      convex.clearAuth();
      return;
    }

    let active = true;
    convex.setAuth(async () => {
      if (!active) return null;
      const result = await authClient.token();
      return result.data?.token ?? null;
    });

    return () => {
      active = false;
      convex.clearAuth();
    };
  }, [authClient, convex, mode, session]);

  useEffect(() => {
    if (mode !== "better-auth") return;

    if (!authUser || !society) {
      syncKeyRef.current = null;
      setStoredUserId(null);
      setSyncPending(false);
      return;
    }

    const syncKey = [
      society._id,
      authUser.id,
      authUser.email,
      authUser.name ?? "",
      authUser.emailVerified ? "verified" : "unverified",
    ].join(":");

    if (syncKeyRef.current === syncKey) return;

    let cancelled = false;
    setSyncPending(true);

    resolveAuthSession({
      societyId: society._id,
      authSubject: authUser.id,
      email: authUser.email,
      displayName: authUser.name ?? authUser.email,
      emailVerified: !!authUser.emailVerified,
    })
      .then((resolved) => {
        if (cancelled) return;
        setStoredUserId(resolved.userId);
        syncKeyRef.current = syncKey;
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[societyer-auth] failed to resolve auth session", error);
      })
      .finally(() => {
        if (!cancelled) setSyncPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    resolveAuthSession,
    authUser,
    society,
  ]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      session: mode === "better-auth" ? sessionState.data ?? null : null,
      isPending:
        mode === "better-auth" ? sessionState.isPending || syncPending : false,
      isAuthenticated:
        mode === "better-auth" ? !!sessionState.data && !syncPending : true,
      signOut: async () => {
        setStoredUserId(null);
        syncKeyRef.current = null;
        if (mode === "better-auth") {
          await authClient.signOut();
        }
      },
    }),
    [authClient, mode, sessionState.data, sessionState.isPending, syncPending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
