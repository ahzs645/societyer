import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAuth } from "../../auth/AuthProvider";
import { AuthPending, AuthShell } from "../../auth/AuthShell";
import { WorkspaceList } from "../../auth/WorkspaceList";
import { useAccountPage } from "./accountPage";
import { formatDate } from "../../lib/format";

type PendingInvitation = { id: string; societyId: string; workspaceName: string; role: string; expiresAtISO: string };
type AcceptResult = { status: string; societyId?: string };
type MyAccessRequest = { id: string; societyId: string; workspaceName: string; status: "pending" | "declined"; createdAtISO: string; decidedAtISO?: string };

export default function MyWorkspacesPage() {
  const { gate } = useAccountPage("My workspaces", "/account/workspaces");
  return gate ?? <MyWorkspaces />;
}

function MyWorkspaces() {
  const auth = useAuth();
  const ready = auth.membershipState === "ready";
  const memberships = auth.membershipStatus === "bound" ? auth.memberships ?? [] : [];
  const empty = ready && memberships.length === 0 && auth.lockedWorkspaces.length === 0;
  return (
    <AuthShell
      title="My workspaces"
      lede="Every workspace you can open with this sign-in. Your role can differ in each one."
      after={<Link to="/app" className="auth__link">Back to workspace</Link>}
    >
      <div className="auth__state">
        {!ready ? <AuthPending>Loading your workspaces…</AuthPending> : (
          <WorkspaceList detailed label="Your workspaces" memberships={memberships} locked={auth.lockedWorkspaces} />
        )}
        {empty && (
          <p className="auth__hint">
            You're not in any workspace yet. Open your invitation link, or ask an administrator to invite {auth.session?.user.email ?? "your email"}.
          </p>
        )}
        <Invitations />
        <AccessRequests />
        <nav className="account-links" aria-label="Account">
          <Link className="auth__link" to="/account/sign-in-methods">Sign-in methods</Link>
          <Link className="auth__link" to="/account/link">Link an existing account</Link>
        </nav>
      </div>
    </AuthShell>
  );
}

/** This sign-in's own pending and recently declined access requests. */
function AccessRequests() {
  const auth = useAuth();
  const requests = useQuery(api.accessRequests.mine, auth.mode === "convex" && auth.isConvexAuthenticated ? {} : "skip") as MyAccessRequest[] | undefined;
  const withdraw = useMutation(api.accessRequests.withdraw);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!requests?.length && !error) return null;
  return (
    <section className="account-section" aria-labelledby="account-requests">
      <h2 id="account-requests" className="account-section__title">Requests</h2>
      {requests?.length ? (
        <ul className="account-workspaces">
          {requests.map((request) => (
            <li key={request.id} className="account-workspace">
              <span className="account-workspace__text">
                <strong className="account-workspace__name">{request.workspaceName}</strong>
                <span className="account-workspace__meta">
                  {request.status === "pending"
                    ? `Waiting for approval · sent ${formatDate(request.createdAtISO)}`
                    : `Declined ${formatDate(request.decidedAtISO ?? request.createdAtISO)}`}
                </span>
              </span>
              {request.status === "pending" && (
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(request.id);
                    setError(null);
                    try {
                      await withdraw({ id: request.id });
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Could not withdraw the request.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === request.id ? "Withdrawing…" : "Withdraw"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
    </section>
  );
}

/** Invitations sent to this sign-in's verified email (same functions as onboarding). */
function Invitations() {
  const auth = useAuth();
  const pending = useQuery(api.invitations.pendingForAccount, auth.isConvexAuthenticated ? {} : "skip") as PendingInvitation[] | undefined;
  const accept = useMutation(api.invitations.acceptForAccount);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!pending?.length && !message) return null;
  return (
    <section className="account-section" aria-labelledby="account-invitations">
      <h2 id="account-invitations" className="account-section__title">Invitations</h2>
      {pending?.length ? (
        <ul className="account-workspaces">
          {pending.map((invitation) => (
            <li key={invitation.id} className="account-workspace">
              <span className="account-workspace__text">
                <strong className="account-workspace__name">{invitation.workspaceName}</strong>
                <span className="account-workspace__meta">Invited as {invitation.role}</span>
              </span>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(invitation.id);
                  setMessage(null);
                  try {
                    const result = await accept({ id: invitation.id }) as AcceptResult;
                    if (result.status !== "invitation-accepted" && result.status !== "bound") {
                      throw new Error("This invitation can no longer be accepted. Ask the administrator to send it again.");
                    }
                    setMessage({ tone: "success", text: `You joined ${invitation.workspaceName}.` });
                    auth.refreshMembership((result.societyId ?? invitation.societyId) as Id<"societies">);
                  } catch (cause) {
                    setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : "Could not join the workspace." });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === invitation.id ? "Joining…" : "Join"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message && <p role={message.tone === "danger" ? "alert" : "status"} className={`notice notice--${message.tone} auth__notice`}>{message.text}</p>}
    </section>
  );
}
