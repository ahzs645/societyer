import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { MembershipResolution } from "../../shared/functions/users";
import type { Id } from "../../convex/_generated/dataModel";
import { useAuth } from "../auth/AuthProvider";

const FAILURE_MESSAGES: Partial<Record<MembershipResolution["status"], string>> = {
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

  if (auth.mode !== "better-auth") return <Navigate to="/app" replace />;
  if (!token) return <InvitationState message="This invitation link is invalid." />;
  if (!auth.session) {
    const redirect = `/invite/${encodeURIComponent(token)}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (error) return <InvitationState message={error} />;
  if (!result) return <InvitationState message="Accepting invitation…" />;
  if (result.status === "invitation-accepted" || result.status === "bound") {
    return (
      <InvitationState message="Invitation accepted. Your workspace membership is ready.">
        <button className="landing__btn landing__btn--primary" onClick={() => navigate("/app")}>
          Open workspace
        </button>
      </InvitationState>
    );
  }
  return <InvitationState message={FAILURE_MESSAGES[result.status] ?? "This invitation cannot be accepted."} />;
}

function InvitationState({
  children,
  message,
}: {
  children?: React.ReactNode;
  message: string;
}) {
  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ minHeight: "100vh" }}>
        <div className="landing__container" style={{ maxWidth: 520 }}>
          <div className="landing__eyebrow"><KeyRound size={12} /> Workspace invitation</div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>Join this workspace</h1>
          <div className="card" role="status" style={{ padding: 20, display: "grid", gap: 14 }}>
            <p style={{ margin: 0 }}>{message}</p>
            {children}
          </div>
        </div>
      </section>
    </div>
  );
}
