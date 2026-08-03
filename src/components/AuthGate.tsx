import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.mode === "better-auth" && auth.isPending) {
    return <div className="page">Authorizing…</div>;
  }

  if (auth.mode === "better-auth" && !auth.isAuthenticated) {
    if (auth.session && auth.membershipStatus === "needs-invitation") {
      return (
        <div className="page">
          <h1>Invitation required</h1>
          <p>This account is not linked to the selected workspace. Open a valid invitation link to continue.</p>
          <button className="btn" type="button" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </div>
      );
    }
    if (auth.session && auth.membershipStatus === "membership-disabled") {
      return <div className="page">This workspace membership has been disabled.</div>;
    }
    if (auth.session && auth.membershipStatus === "ambiguous-binding") {
      return <div className="page">This account has conflicting workspace bindings. Contact an administrator.</div>;
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
