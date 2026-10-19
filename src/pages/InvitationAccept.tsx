import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import type { MembershipResolution } from "../../shared/functions/users";
import type { Id } from "../../convex/_generated/dataModel";
import { useAuth } from "../auth/AuthProvider";
import { AuthPending, AuthShell } from "../auth/AuthShell";

const FAILURE_MESSAGES: Partial<Record<MembershipResolution["status"], string>> = {
  "invitation-expired": "This invitation has expired. Ask a workspace administrator to issue another link.",
  "invitation-email-unverified": "Verify your email address with your sign-in provider before accepting this invitation.",
  "invitation-issuer-unavailable": "The inviting administrator no longer has authority to grant this access. Ask a current owner to reissue the invitation.",
  "invalid-invitation": "This invitation link is invalid.",
  "invitation-revoked": "This invitation has been revoked.",
  "invitation-already-accepted": "This invitation has already been used.",
  "invitation-email-mismatch": "Sign in with the email address this invitation was sent to.",
  "invitation-society-mismatch": "This invitation does not match the requested workspace.",
  "membership-disabled": "Your existing workspace membership is disabled.",
  "ambiguous-binding": "This account has conflicting workspace bindings. Contact an administrator.",
  "unauthenticated": "Sign in before accepting this invitation.",
};

export function InvitationAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const auth = useAuth();
  const accept = useMutation(api.invitations.accept);
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const attemptedToken = useRef<string | null>(null);
  const [result, setResult] = useState<MembershipResolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !token ||
      !auth.session ||
      !auth.isConvexAuthenticated ||
      auth.membershipState !== "ready"
    ) return;
    if (attemptedToken.current === token) return;
    attemptedToken.current = token;
    setError(null);

    accept({ token })
      .then((outcome: MembershipResolution) => {
        setResult(outcome);
        if (outcome.status !== "invitation-accepted" && outcome.status !== "bound") return;
        auth.refreshMembership(outcome.societyId as Id<"societies">);
      })
      .catch((cause: unknown) => {
        console.error("[societyer-auth] invitation acceptance failed", cause);
        setError("The invitation could not be accepted. Please try again.");
        attemptedToken.current = null;
      });
  }, [accept, auth, token]);

  if (auth.mode === "none") return <Navigate to="/app" replace />;
  if (!token) return <InvitationState message="This invitation link is invalid." />;
  if (auth.sessionStatus === "loading") return <InvitationState pending message="Checking your sign-in…" />;
  // Without this, a rejected Convex token (e.g. a missing Clerk JWT template)
  // or a failed membership lookup leaves the page on "Accepting invitation…".
  const authProblem = auth.fatalError?.message
    ?? (auth.session && auth.convexAuthStatus === "unauthenticated"
      ? "Your sign-in could not be verified by the workspace server. Sign out and sign in again, or contact an administrator."
      : null);
  if (authProblem) {
    return (
      <InvitationState message={authProblem}>
        <div className="auth__actions">
          {auth.fatalError?.retryable && (
            <button className="btn btn--primary auth__submit" type="button" onClick={auth.retryAuthentication}>Retry</button>
          )}
          <button className="btn auth__submit" type="button" onClick={() => void auth.signOut()}>Sign out</button>
        </div>
      </InvitationState>
    );
  }
  if (!auth.session) {
    const redirect = `/invite/${encodeURIComponent(token)}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (error) return <InvitationState message={error} />;
  if (!result) return <InvitationState pending message="Accepting invitation…" />;
  if (result.status === "invitation-accepted" || result.status === "bound") {
    return (
      <InvitationState message="Invitation accepted. Your workspace membership is ready.">
        <button className="btn btn--primary auth__submit" type="button" onClick={() => navigate("/app")}>
          Open workspace
        </button>
      </InvitationState>
    );
  }
  if (result.status === "invitation-email-unverified" && auth.mode === "convex") {
    return <InvitationState message="Verify your email to join this workspace. You do not need to create an organization.">
      <button className="btn btn--primary auth__submit" disabled={resending} onClick={async () => {
        setResending(true);
        try {
          const { loadSessionAuthClient } = await import("../lib/sessionAuthClient");
          const { authClient } = await loadSessionAuthClient();
          const callbackURL = new URL(`/login?verified=1&redirect=${encodeURIComponent(`/invite/${token}`)}`, window.location.origin).href;
          const response = await authClient.sendVerificationEmail({ email: auth.session!.user.email!, callbackURL });
          if (response.error) throw new Error(response.error.message);
          setResendMessage("Check your email for a fresh verification link, then sign in.");
        } catch { setResendMessage("Could not request the email. Please try again in a minute."); }
        finally { setResending(false); }
      }}>{resending ? "Requesting…" : "Send verification email"}</button>
      {resendMessage && <p role="status">{resendMessage}</p>}
    </InvitationState>;
  }
  return <InvitationState message={FAILURE_MESSAGES[result.status] ?? "This invitation cannot be accepted."}>
    {result.status === "invitation-email-mismatch" && <button className="btn auth__submit" onClick={() => void auth.signOut()}>Sign in with another account</button>}
    <button className="btn auth__submit" onClick={() => navigate("/app")}>Go to your workspace</button>
  </InvitationState>;
}

function InvitationState({
  children,
  message,
  pending = false,
}: {
  children?: React.ReactNode;
  message: string;
  pending?: boolean;
}) {
  // Pending steps update the spinner's own status line; a result moves focus
  // to the title and the shell's live region reads the message.
  return (
    <AuthShell title="Join this workspace" stateKey={pending ? "pending" : message} announce={pending ? undefined : message}>
      <div className="auth__state">
        {pending ? <AuthPending>{message}</AuthPending> : <p className="auth__message">{message}</p>}
        {children}
      </div>
    </AuthShell>
  );
}
