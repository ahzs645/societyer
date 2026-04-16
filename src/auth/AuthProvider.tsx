import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient, BetterAuthSession } from "../lib/authClient";
import { getAuthMode, type AuthMode } from "../lib/authMode";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";

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

  if (mode !== "better-auth" || isStaticDemoRuntime()) {
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
  const sessionState = authClient.useSession();
  const society = useSociety();
  const resolveAuthSession = useMutation(api.users.resolveAuthSession);
  const syncKeyRef = useRef<string | null>(null);
  const [syncPending, setSyncPending] = useState(false);

  useEffect(() => {
    if (mode !== "better-auth") return;

    const authUser = sessionState.data?.user;
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
    sessionState.data?.user?.email,
    sessionState.data?.user?.emailVerified,
    sessionState.data?.user?.id,
    sessionState.data?.user?.name,
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
    [mode, sessionState.data, sessionState.isPending, syncPending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
