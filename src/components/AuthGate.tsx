import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../lib/convexApi";
import { useAuth } from "../auth/AuthProvider";
import { DeploymentCapabilitiesGate, usePrefetchDeploymentCapabilities } from "./DeploymentCapabilities";
import { AppBootScreen } from "./AppBootScreen";
import { useSociety, useStoredSocietyId } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { PendingInvitations } from "./PendingInvitations";
import { WorkspaceMfaActions } from "../auth/WorkspaceMfaActions";
import { AuthShell } from "../auth/AuthShell";
import { useAccessRequestAvailability } from "../auth/RequestWorkspaceAccess";

const WorkspaceAccessScreen = lazy(() => import("../auth/WorkspaceAccessScreen"));

export function AuthGate({ children, allowWorkspaceCreation = false }: { children: React.ReactNode; allowWorkspaceCreation?: boolean }) {
  const auth = useAuth();
  const creationAccess = useQuery(api.http.workspaceCreationAccess, auth.mode !== "none" && auth.sessionStatus === "authenticated" && auth.convexAuthStatus === "authenticated" && auth.membershipState === "ready" && auth.membershipStatus === "needs-invitation" ? {} : "skip");
  const invitations = useQuery(api.invitations.pendingForAccount, auth.mode !== "none" && auth.isConvexAuthenticated && auth.membershipState === "ready" && auth.membershipStatus === "needs-invitation" ? {} : "skip");
  // A person with no workspace yet, on a domain whose workspace takes access requests.
  const accessRequests = useAccessRequestAvailability(auth.membershipState === "ready" && auth.membershipStatus === "needs-invitation" ? auth.domainWorkspace?.societyId : undefined);
  usePrefetchDeploymentCapabilities();
  usePreloadWorkspaceShell(auth.mode !== "none" && Boolean(auth.session));

  if (auth.mode === "none") return <DeploymentCapabilitiesGate>{children}</DeploymentCapabilitiesGate>;

  if (auth.fatalError) {
    const expired = auth.fatalError.kind === "expired-session";
    return (
      <AuthMessage
        title={expired ? "Session expired" : "Authentication unavailable"}
        message={auth.fatalError.message}
      >
        {expired && (
          <button className="btn btn--primary auth__submit" type="button" onClick={() => void auth.signOut()}>Sign in again</button>
        )}
        {auth.fatalError.retryable && (
          <button className={expired ? "btn auth__submit" : "btn btn--primary auth__submit"} type="button" onClick={auth.retryAuthentication}>
            Try again
          </button>
        )}
        {!expired && (
          <button className="btn auth__submit" type="button" onClick={() => void auth.signOut()}>Sign out</button>
        )}
      </AuthMessage>
    );
  }

  if (
    auth.sessionStatus === "loading" ||
    auth.convexAuthStatus === "loading" ||
    auth.membershipState === "loading"
  ) {
    return <AppBootScreen label="Checking your secure workspace access…" />;
  }

  if (auth.sessionStatus !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (auth.convexAuthStatus !== "authenticated") {
    return (
      <AuthMessage
        title="Secure sign-in failed"
        message="Societyer could not confirm your workspace token. Retry, or sign in again."
      >
        <button className="btn btn--primary auth__submit" type="button" onClick={auth.retryAuthentication}>Try again</button>
        <button className="btn auth__submit" type="button" onClick={() => void auth.signOut()}>Sign out</button>
      </AuthMessage>
    );
  }

  if (auth.membershipState !== "ready" || auth.membershipStatus !== "bound") {
    if (auth.membershipStatus === "unauthenticated") {
      return (
        <AuthMessage title="Sign in again" message="Your sign-in must be refreshed to continue.">
          <button className="btn btn--primary auth__submit" type="button" onClick={() => void auth.signOut()}>Sign in again</button>
        </AuthMessage>
      );
    }
    if (auth.membershipStatus === "mfa-required") {
      return (
        <AuthMessage title="Two-factor authentication required"
          message={`Verify a second factor to access ${auth.lockedWorkspaces.map(({ name }) => name).join(", ")}. Set up two-factor authentication in your account, or sign in again if it’s already set up.`}>
          <WorkspaceMfaActions />
        </AuthMessage>
      );
    }
    if (auth.membershipStatus === "sign-in-required") return <AccessScreen />;
    if (auth.membershipStatus === "needs-invitation") {
      if (invitations === undefined) return <AppBootScreen label="Looking for invitations sent to your verified email…" />;
      if (invitations.length) return <div className="page"><h1>Join your workspace</h1><PendingInvitations /><button className="btn" onClick={() => void auth.signOut()}>Sign out</button></div>;
      if (auth.mode === "convex" && auth.domainWorkspace && accessRequests === undefined) return <AppBootScreen label="Checking your secure workspace access…" />;
      if (accessRequests?.enabled) return <AccessScreen />;
      if (creationAccess === undefined) return <AppBootScreen label="Checking whether this account can create its own workspace…" />;
      if (allowWorkspaceCreation && creationAccess.allowed) return <DeploymentCapabilitiesGate>{children}</DeploymentCapabilitiesGate>;
      return (
        <AuthMessage
          title={creationAccess.allowed ? "Set up your workspace" : "Invitation required"}
          message={creationAccess.allowed ? "Create your own organization workspace, or open an invitation to join an existing organization. A new workspace does not give access to anyone else's records." : creationAccess.reason}
        >
          {creationAccess.allowed && <Link className="btn btn--primary auth__submit" to="/app/society/new">Set up an organization</Link>}
          <button className={creationAccess.allowed ? "btn auth__submit" : "btn btn--primary auth__submit"} type="button" onClick={() => void auth.signOut()}>Sign out</button>
        </AuthMessage>
      );
    }
    if (auth.membershipStatus === "membership-revoked") {
      return (
        <AuthMessage
          title="Workspace access revoked"
          message="Your workspace membership is no longer active. Contact a workspace administrator if this is unexpected."
        >
          <button className="btn btn--primary auth__submit" type="button" onClick={auth.retryAuthentication}>Check again</button>
          <button className="btn auth__submit" type="button" onClick={() => void auth.signOut()}>Sign out</button>
        </AuthMessage>
      );
    }
    if (auth.membershipStatus === "membership-disabled") {
      return (
        <AuthMessage
          title="Account disabled"
          message="Your workspace user has been disabled. Contact a workspace administrator for help."
        >
          <button className="btn btn--primary auth__submit" type="button" onClick={() => void auth.signOut()}>Sign out</button>
        </AuthMessage>
      );
    }
    if (auth.membershipStatus === "ambiguous-binding") {
      return (
        <AuthMessage
          title="Workspace access conflict"
          message="This account has conflicting workspace bindings. Contact an administrator."
        />
      );
    }
    return <AuthMessage title="Workspace unavailable" message="Your workspace membership could not be confirmed." />;
  }

  // Sign-in chose a workspace this session can't open: never fall through to another one.
  if (auth.startup?.kind === "locked" || auth.startup?.kind === "no-access-here") return <AccessScreen />;

  return (
    <DeploymentCapabilitiesGate>
      <WorkspaceReadyGate>{children}</WorkspaceReadyGate>
    </DeploymentCapabilitiesGate>
  );
}

function AccessScreen() {
  return (
    <Suspense fallback={<AppBootScreen label="Checking your secure workspace access…" />}>
      <WorkspaceAccessScreen />
    </Suspense>
  );
}

/**
 * Keeps the boot screen up until the selected workspace and the member's
 * permissions have loaded, so the shell first appears with its real sidebar
 * and the page skeleton rather than a placeholder workspace and a status line.
 * Without a resolved user the permission query cannot run; the shell then
 * renders and its route gate reports the state, rather than holding a
 * full-screen spinner with no way out.
 */
function WorkspaceReadyGate({ children }: { children: React.ReactNode }) {
  const society = useSociety();
  const userId = useCurrentUserId();
  const { loaded } = usePermissions();
  // Only the first load waits here. A later workspace switch keeps the shell
  // mounted and lets the route gate draw the page skeleton.
  const [opened, setOpened] = useState(false);
  // Sign-in already chose the workspace and member, so look up permissions
  // alongside the workspace list rather than after it. usePermissions() asks
  // for the same arguments once the list arrives and shares this
  // subscription, so keeping it open afterwards costs nothing.
  const storedSocietyId = useStoredSocietyId();
  useQuery(api.permissions.myPermissions, storedSocietyId && userId ? { societyId: storedSocietyId, userId } : "skip");
  const waiting = society === undefined || Boolean(society && userId && !loaded);
  if (!waiting && !opened) setOpened(true);
  if (waiting && !opened) return <AppBootScreen label="Opening your workspace…" />;
  return <>{children}</>;
}

/**
 * Fetches the app shell's code (and the dashboard's, when that is where the
 * member is going) while sign-in is still being checked, so it is ready when
 * the checks pass. A failed preload is ignored; the route's own lazy import
 * reports it.
 */
function usePreloadWorkspaceShell(signedIn: boolean) {
  const { pathname } = useLocation();
  const inApp = pathname === "/app" || pathname.startsWith("/app/");
  const toDashboard = pathname === "/app" || pathname === "/app/";
  useEffect(() => {
    if (!signedIn || !inApp) return;
    void import("./Layout").catch(() => undefined);
    if (toDashboard) void import("../pages/Dashboard").catch(() => undefined);
  }, [signedIn, inApp, toDashboard]);
}

/**
 * A signed-in state that stops short of the workspace (expired session,
 * revoked access, …), drawn in the sign-in pages' frame so it reads as part of
 * signing in rather than as a broken app page. Pass the actions as buttons
 * with `auth__submit`, the main one also `btn--primary`.
 */
function AuthMessage({
  children,
  message,
  title,
}: {
  children?: React.ReactNode;
  message: string;
  title: string;
}) {
  return (
    <AuthShell title={title} lede={message} help="Trouble signing in?">
      {children && <div className="auth__actions">{children}</div>}
    </AuthShell>
  );
}
