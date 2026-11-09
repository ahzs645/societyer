import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AuthShell } from "../auth/AuthShell";
import { AppBootScreen } from "../components/AppBootScreen";
import { handoffOutcome } from "../lib/sessionHandoff";

/**
 * Landing for a cross-domain session handoff. The code in the fragment was
 * already stripped and redeemed before the session hook mounted
 * (`completeSessionHandoff` in convexAuthClient.ts); this page only continues.
 */
export default function HandoffPage() {
  const auth = useAuth();
  const outcome = handoffOutcome();
  const next = outcome?.next ?? "/app";
  if (auth.mode !== "convex") return <Navigate to="/app" replace />;
  if (outcome?.status === "redeemed") {
    if (auth.sessionStatus === "loading") return <AppBootScreen label="Opening your workspace…" />;
    // The workspace from the link is applied by sign-in's startup choice, and
    // only if this login is a member there.
    if (auth.session) return <Navigate to={next} replace />;
  }
  return (
    <AuthShell title="Sign in to continue" lede="This link expired or was already used. Sign in to continue.">
      <Link className="btn btn--primary auth__submit" to={`/login?redirect=${encodeURIComponent(next)}`}>{auth.session ? "Continue" : "Sign in"}</Link>
    </AuthShell>
  );
}
