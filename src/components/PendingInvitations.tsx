import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/convexApi";
import { useAuth } from "../auth/AuthProvider";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "./ui";

/** Account-level inbox, usable before the first workspace exists. */
export function PendingInvitations({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  const pending = useQuery(api.invitations.pendingForAccount, auth.mode !== "none" && auth.isConvexAuthenticated ? {} : "skip");
  const accept = useMutation(api.invitations.acceptForAccount);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (compact && !pending?.length) return null;
  return <section className="card" aria-label="Workspace invitations" style={{ marginBottom: 16 }}>
    <div className="card__head"><h2 className="card__title">Workspace invitations</h2></div>
    <div className="card__body">
      {pending === undefined ? <p role="status">Checking your invitations…</p> : pending.length === 0 ? <p>No pending invitations for this verified email address. Open an invitation link, or ask the administrator to invite the email you signed in with.</p> : <>
        <p>You can join an existing workspace directly. You don’t need to create an organization.</p>
        {pending.map((invitation: any) => <div className="row" key={invitation.id} style={{ gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <strong>{invitation.workspaceName}</strong><Badge>{invitation.role}</Badge>
          <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={async () => {
            setBusy(invitation.id); setError(null);
            try {
              const result = await accept({ id: invitation.id });
              if (result.status !== "invitation-accepted" && result.status !== "bound") throw new Error("This invitation can no longer be accepted. Ask the administrator to resend it.");
              auth.refreshMembership(result.societyId as Id<"societies">);
              navigate("/app", { replace: true });
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join the workspace."); }
            finally { setBusy(null); }
          }}>{busy === invitation.id ? "Joining…" : "Join workspace"}</button>
        </div>)}
      </>}
      {error && <p role="alert" className="notice notice--danger">{error}</p>}
    </div>
  </section>;
}
