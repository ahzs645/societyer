import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { MembershipResolution } from "../../shared/functions/users";
import { getAuthMode, type AuthMode } from "../lib/authMode";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { setPrincipalUsers, setStoredUserId } from "../hooks/useCurrentUser";
import {
  getStoredSocietyId,
  setMembershipSocietyIds,
  setStoredSocietyId,
} from "../hooks/useSociety";

type AuthClient = typeof import("../lib/authClient").authClient;
type BetterAuthSession = AuthClient["$Infer"]["Session"];

export type AuthStage = "idle" | "loading" | "ready" | "error";
export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";
export type ConvexAuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated" | "error";
export type MembershipStatus = MembershipResolution["status"] | "membership-revoked";
export type AuthFailureKind =
  | "expired-session"
  | "jwks-token"
  | "network"
  | "membership"
  | "unknown";

export type AuthFailure = {
  kind: AuthFailureKind;
  message: string;
  retryable: boolean;
};

type PrincipalMembership = {
  userId: Id<"users">;
  role: string;
  user: Doc<"users">;
  society: Doc<"societies">;
};

type MembershipLookup = {
  status: MembershipStatus;
  authSubject?: string;
  memberships: PrincipalMembership[];
};

type AuthContextValue = {
  mode: AuthMode;
  session: BetterAuthSession | null;
  sessionStatus: SessionStatus;
  convexAuthStatus: ConvexAuthStatus;
  membershipState: AuthStage;
  membershipStatus: MembershipStatus | null;
  societies: Doc<"societies">[] | undefined;
  fatalError: AuthFailure | null;
  isPending: boolean;
  isAuthenticated: boolean;
  isConvexAuthenticated: boolean;
  refreshMembership: (preferredSocietyId?: Id<"societies">) => void;
  retryAuthentication: () => void;
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
      sessionStatus: "authenticated",
      convexAuthStatus: "authenticated",
      membershipState: "ready",
      membershipStatus: "bound",
      societies: undefined,
      fatalError: null,
      isPending: false,
      isAuthenticated: true,
      isConvexAuthenticated: true,
      refreshMembership: () => undefined,
      retryAuthentication: () => undefined,
      signOut: async () => {
        setStoredSocietyId(null);
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
  const [loadError, setLoadError] = useState<AuthFailure | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setAuthClient(null);
    setLoadError(null);
    import("../lib/authClient")
      .then((module) => {
        if (active) setAuthClient(module.authClient);
      })
      .catch((error: unknown) => {
        console.error("[societyer-auth] failed to load auth client", error);
        if (active) setLoadError(authFailure(error, "Authentication could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  if (!authClient) {
    if (loadError) {
      return (
        <AuthState title="Authentication unavailable" message={loadError.message}>
          <button className="btn" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </button>
        </AuthState>
      );
    }
    return <AuthState title="Authorizing" message="Checking your session…" />;
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
  const sessionResult = authClient.useSession();
  const session = sessionResult.data ?? null;
  const convex = useConvex();
  const convexAuth = useConvexAuth();
  const [tokenFailure, setTokenFailure] = useState<AuthFailure | null>(null);
  const [membershipFailure, setMembershipFailure] = useState<AuthFailure | null>(null);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null);
  const [memberships, setMemberships] = useState<PrincipalMembership[] | null>(null);
  const [membershipRefresh, setMembershipRefresh] = useState(0);
  const [authRetry, setAuthRetry] = useState(0);
  const hadSessionRef = useRef(false);
  const hadMembershipRef = useRef(false);
  const signingOutRef = useRef(false);
  const preferredSocietyIdRef = useRef<Id<"societies"> | null>(null);

  const sessionError = "error" in sessionResult ? sessionResult.error : null;
  const sessionFailure = sessionError
    ? authFailure(sessionError, "Your session could not be checked.")
    : null;

  useEffect(() => {
    if (session) {
      hadSessionRef.current = true;
      signingOutRef.current = false;
      return;
    }
    if (!sessionResult.isPending && hadSessionRef.current && !signingOutRef.current) {
      setTokenFailure({
        kind: "expired-session",
        message: "Your session has expired. Sign in again to continue.",
        retryable: false,
      });
    }
  }, [session, sessionResult.isPending]);

  useEffect(() => {
    if (mode !== "better-auth" || !session) {
      convex.clearAuth();
      return;
    }

    let active = true;
    setTokenFailure(null);
    convex.setAuth(async () => {
      if (!active) return null;
      try {
        const result = await authClient.token();
        const token = result.data?.token;
        if (!token) throw new Error("The authentication server did not issue a Convex token.");
        if (active) setTokenFailure(null);
        return token;
      } catch (error: unknown) {
        const failure = authFailure(error, "The secure workspace token could not be verified.");
        console.error("[societyer-auth] failed to obtain Convex token", error);
        if (active) setTokenFailure(failure.kind === "network" ? failure : { ...failure, kind: "jwks-token" });
        return null;
      }
    });

    return () => {
      active = false;
      convex.clearAuth();
    };
  }, [authClient, authRetry, convex, mode, session]);

  useEffect(() => {
    if (!session || !convexAuth.isAuthenticated) {
      setMembershipSocietyIds(null);
      setPrincipalUsers(null);
      setStoredSocietyId(null);
      setStoredUserId(null);
      setMemberships(null);
      setMembershipStatus(null);
      setMembershipFailure(null);
      return;
    }

    let active = true;
    setMemberships(null);
    setMembershipStatus(null);
    setMembershipFailure(null);
    convex
      .query(api.http.currentPrincipalMemberships, {})
      .then((lookup: MembershipLookup) => {
        if (!active) return;
        const resolvedStatus =
          lookup.status === "needs-invitation" && hadMembershipRef.current
            ? "membership-revoked"
            : lookup.status;
        setMembershipStatus(resolvedStatus);
        setMemberships(lookup.memberships);

        setMembershipSocietyIds(lookup.memberships.map((membership) => ({
          societyId: membership.society._id,
          userId: membership.userId,
        })));
        setPrincipalUsers(lookup.memberships.map((membership) => membership.user));
        if (resolvedStatus !== "bound" || lookup.memberships.length === 0) {
          setStoredSocietyId(null);
          setStoredUserId(null);
          return;
        }

        hadMembershipRef.current = true;
        const storedSocietyId = preferredSocietyIdRef.current ?? getStoredSocietyId();
        const selected = lookup.memberships.find(
          (membership) => membership.society._id === storedSocietyId,
        ) ?? lookup.memberships[0];
        preferredSocietyIdRef.current = null;
        setStoredSocietyId(selected.society._id);
        setStoredUserId(selected.userId);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("[societyer-auth] failed to resolve principal memberships", error);
        setMembershipSocietyIds(null);
        setPrincipalUsers(null);
        setStoredSocietyId(null);
        setStoredUserId(null);
        setMemberships([]);
        setMembershipFailure(authFailure(error, "Your workspace membership could not be checked."));
      });

    return () => {
      active = false;
    };
  }, [convex, convexAuth.isAuthenticated, membershipRefresh, session]);

  const sessionStatus: SessionStatus = sessionResult.isPending
    ? "loading"
    : sessionFailure
      ? "error"
      : session
        ? "authenticated"
        : "unauthenticated";
  const convexAuthStatus: ConvexAuthStatus = !session
    ? "idle"
    : tokenFailure
      ? "error"
      : convexAuth.isLoading
        ? "loading"
        : convexAuth.isAuthenticated
          ? "authenticated"
          : "unauthenticated";
  const membershipState: AuthStage = membershipFailure
    ? "error"
    : !session || !convexAuth.isAuthenticated
      ? "idle"
      : memberships === null || membershipStatus === null
        ? "loading"
        : "ready";
  const fatalError = sessionFailure ?? tokenFailure ?? membershipFailure;
  const isAuthenticated =
    sessionStatus === "authenticated" &&
    convexAuthStatus === "authenticated" &&
    membershipState === "ready" &&
    membershipStatus === "bound";

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      session,
      sessionStatus,
      convexAuthStatus,
      membershipState,
      membershipStatus,
      societies: memberships?.map((membership) => membership.society),
      fatalError,
      isPending:
        sessionStatus === "loading" ||
        convexAuthStatus === "loading" ||
        membershipState === "loading",
      isAuthenticated,
      isConvexAuthenticated: convexAuthStatus === "authenticated",
      refreshMembership: (preferredSocietyId) => {
        preferredSocietyIdRef.current = preferredSocietyId ?? null;
        setMembershipRefresh((value) => value + 1);
      },
      retryAuthentication: () => {
        setTokenFailure(null);
        setMembershipFailure(null);
        setAuthRetry((value) => value + 1);
        setMembershipRefresh((value) => value + 1);
      },
      signOut: async () => {
        signingOutRef.current = true;
        hadSessionRef.current = false;
        hadMembershipRef.current = false;
        setMembershipSocietyIds(null);
        setPrincipalUsers(null);
        setStoredSocietyId(null);
        setStoredUserId(null);
        setMemberships(null);
        setMembershipStatus(null);
        setTokenFailure(null);
        setMembershipFailure(null);
        await authClient.signOut();
      },
    }),
    [
      authClient,
      convexAuthStatus,
      fatalError,
      isAuthenticated,
      membershipState,
      membershipStatus,
      memberships,
      mode,
      session,
      sessionStatus,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function authFailure(error: unknown, fallback: string): AuthFailure {
  const message = error instanceof Error ? error.message : fallback;
  const normalized = message.toLowerCase();
  if (/network|fetch|offline|websocket|connection|timeout/.test(normalized)) {
    return { kind: "network", message: `${fallback} Check your connection and try again.`, retryable: true };
  }
  if (/jwks|jwt|token|issuer|signature/.test(normalized)) {
    return { kind: "jwks-token", message: "Secure sign-in verification failed. Please retry or sign in again.", retryable: true };
  }
  if (/membership|society|workspace|disabled/.test(normalized)) {
    return { kind: "membership", message: fallback, retryable: true };
  }
  return { kind: "unknown", message: message || fallback, retryable: true };
}

function AuthState({
  children,
  message,
  title,
}: {
  children?: React.ReactNode;
  message: string;
  title: string;
}) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p>{message}</p>
      {children}
    </div>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
