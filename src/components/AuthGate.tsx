import { Link, Navigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../lib/convexApi";
import { useAuth } from "../auth/AuthProvider";

export function AuthGate({ children, allowWorkspaceCreation = false }: { children: React.ReactNode; allowWorkspaceCreation?: boolean }) {
  const auth = useAuth();
  const creationAccess = useQuery(api.http.workspaceCreationAccess, auth.mode !== "none" && auth.sessionStatus === "authenticated" && auth.convexAuthStatus === "authenticated" && auth.membershipState === "ready" && auth.membershipStatus === "needs-invitation" ? {} : "skip");

  if (auth.mode === "none") return <>{children}</>;

  if (auth.fatalError) {
    const expired = auth.fatalError.kind === "expired-session";
    return (
      <AuthMessage
        title={expired ? "Session expired" : "Authentication unavailable"}
        message={auth.fatalError.message}
      >
        {auth.fatalError.retryable && (
          <button className="btn" type="button" onClick={auth.retryAuthentication}>
            Retry
          </button>
        )}
        <button className="btn" type="button" onClick={() => void auth.signOut()}>
          {expired ? "Sign in again" : "Sign out"}
        </button>
      </AuthMessage>
    );
  }

  if (
    auth.sessionStatus === "loading" ||
    auth.convexAuthStatus === "loading" ||
    auth.membershipState === "loading"
  ) {
    return <AuthMessage title="Authorizing" message="Checking your secure workspace access…" />;
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
        <button className="btn" type="button" onClick={auth.retryAuthentication}>Retry</button>
        <button className="btn" type="button" onClick={() => void auth.signOut()}>Sign out</button>
      </AuthMessage>
    );
  }

  if (auth.membershipState !== "ready" || auth.membershipStatus !== "bound") {
    if (auth.membershipStatus === "needs-invitation") {
      if (creationAccess === undefined) return <AuthMessage title="Checking setup access" message="Checking whether this account can create its own workspace…" />;
      if (allowWorkspaceCreation && creationAccess.allowed) return <>{children}</>;
      return (
        <AuthMessage
          title={creationAccess.allowed ? "Set up your workspace" : "Invitation required"}
          message={creationAccess.allowed ? "Create your own organization workspace, or open an invitation to join an existing organization. A new workspace does not give access to anyone else's records." : creationAccess.reason}
        >
          {creationAccess.allowed && <Link className="btn btn--accent" to="/app/society/new">Set up an organization</Link>}
          <button className="btn" type="button" onClick={() => void auth.signOut()}>Sign out</button>
        </AuthMessage>
      );
    }
    if (auth.membershipStatus === "membership-revoked") {
      return (
        <AuthMessage
          title="Workspace access revoked"
          message="Your workspace membership is no longer active. Contact a workspace administrator if this is unexpected."
        >
          <button className="btn" type="button" onClick={auth.retryAuthentication}>Check again</button>
          <button className="btn" type="button" onClick={() => void auth.signOut()}>Sign out</button>
        </AuthMessage>
      );
    }
    if (auth.membershipStatus === "membership-disabled") {
      return (
        <AuthMessage
          title="Account disabled"
          message="Your workspace user has been disabled. Contact a workspace administrator for help."
        >
          <button className="btn" type="button" onClick={() => void auth.signOut()}>Sign out</button>
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

  return <>{children}</>;
}

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
    <div className="page">
      <h1>{title}</h1>
      <p>{message}</p>
      {children && <div style={{ display: "flex", gap: 8 }}>{children}</div>}
    </div>
  );
}
