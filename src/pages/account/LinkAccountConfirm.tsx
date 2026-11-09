import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useAuth } from "../../auth/AuthProvider";
import { AuthPending, AuthShell, BusyLabel } from "../../auth/AuthShell";
import { useToast } from "../../components/Toast";
import { clearLinkCode, readLinkCode, type PendingLinkCode } from "./accountLinkCode";
import { LINK_SIGN_IN_PATH, useAccountPage } from "./accountPage";

type LinkSide = { email?: string; name?: string; workspaces: Array<{ name: string; role: string; status: string }> };
type LinkFailureStatus =
  | "invalid" | "expired" | "same-account" | "already-linked" | "reauthentication-required"
  | "conflict" | "identity-disabled" | "unauthenticated";
type LinkFailure = { status: LinkFailureStatus; conflicts?: Array<{ workspaceName: string }> };
type ReadyPreview = { status: "ready"; initiator: LinkSide; current: LinkSide };
type PreviewResult = ReadyPreview | LinkFailure;
type ConfirmResult = { status: "linked" } | LinkFailure;

/** Failures the person can fix by signing in as the other login again; the code stays. */
const RETRYABLE: ReadonlySet<LinkFailureStatus> = new Set(["same-account", "reauthentication-required", "unauthenticated"]);

function failureCopy(failure: LinkFailure): { title: string; message: string } {
  switch (failure.status) {
    case "expired": return { title: "Link expired", message: "Links last 10 minutes. Start again from the first login." };
    case "invalid": return { title: "Link not found", message: "This link was cancelled, already used, or replaced by a newer one. Start again from the first login." };
    case "same-account": return { title: "Same login", message: "You signed in to the login that started the link. Sign in to the other login instead." };
    case "already-linked": return { title: "Already linked", message: "These logins are already linked. Their workspaces are in My workspaces." };
    case "reauthentication-required": return { title: "Sign in again", message: "For your security, linking needs a recent sign-in. Sign in to this login again to confirm." };
    case "unauthenticated": return { title: "Sign in to continue", message: "Sign in to the login you want to link." };
    case "identity-disabled": return { title: "Can't link these logins", message: "One of these logins is disabled. Contact your administrator." };
    case "conflict": {
      const names = failure.conflicts?.map((conflict) => conflict.workspaceName).join(", ");
      return {
        title: "Can't link these logins",
        message: `Both logins are members of ${names || "the same workspace"}. A person can only have one membership in each workspace, so ask that workspace's administrator to remove one first.`,
      };
    }
  }
}

/**
 * Step 2 of "Link an existing account": signed in as the second login, check
 * both accounts and confirm. The code comes only from this tab's sessionStorage.
 */
export default function LinkAccountConfirmPage() {
  const { gate, signOutTo } = useAccountPage("Confirm the link", "/account/link/confirm", LINK_SIGN_IN_PATH);
  const [pending] = useState(() => readLinkCode());
  if (gate) return gate;
  if (!pending) {
    return (
      <AuthShell title="No link in progress" lede="Links last 10 minutes and only work in the tab where they started.">
        <Link className="btn btn--primary auth__submit" to="/account/link">Start again</Link>
      </AuthShell>
    );
  }
  return <LinkAccountConfirm pending={pending} signOutTo={signOutTo} />;
}

function LinkAccountConfirm({ pending, signOutTo }: { pending: PendingLinkCode; signOutTo: (target: string) => Promise<void> }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirmLink = useMutation(api.accountLinks.confirm);
  const cancelLink = useMutation(api.accountLinks.cancel);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [failure, setFailure] = useState<LinkFailure | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The preview being confirmed. While confirming, and once failed, stop
  // asking about a code that is about to be spent.
  const [confirming, setConfirming] = useState<ReadyPreview | null>(null);
  const live = useQuery(
    api.accountLinks.preview,
    auth.isConvexAuthenticated && !failure && !confirming ? { code: pending.code } : "skip",
  ) as PreviewResult | undefined;
  const preview = confirming ?? live;
  const shown: LinkFailure | null = failure ?? (preview && preview.status !== "ready" ? preview : null);
  const terminal = shown !== null && !RETRYABLE.has(shown.status);
  useEffect(() => { if (terminal) clearLinkCode(); }, [terminal]);

  const finish = () => navigate("/account/workspaces", { replace: true });

  const cancel = async () => {
    setBusy("cancel");
    try {
      await cancelLink({ code: pending.code });
    } catch (cause) {
      // The code expires on its own; leaving still has to work.
      console.warn("[societyer-auth] link cancel failed", cause);
    }
    clearLinkCode();
    finish();
  };

  const confirm = async (ready: ReadyPreview) => {
    setConfirming(ready);
    setBusy("confirm");
    setError(null);
    try {
      const result = await confirmLink({ code: pending.code }) as ConfirmResult;
      if (result.status === "linked") {
        clearLinkCode();
        auth.refreshMembership();
        toast.success("Logins linked", "Workspaces from both logins are now in My workspaces.");
        finish();
        return;
      }
      setFailure(result);
    } catch (cause) {
      console.error("[societyer-auth] link confirm failed", cause);
      setError("The link couldn't be confirmed. Try again.");
    }
    setConfirming(null);
    setBusy(null);
  };

  if (shown) {
    const copy = failureCopy(shown);
    return (
      <AuthShell
        title={copy.title}
        lede={copy.message}
        stateKey={shown.status}
        after={<Link to="/account/workspaces" className="auth__link">My workspaces</Link>}
      >
        <div className="auth__actions">
          {RETRYABLE.has(shown.status) ? (
            <>
              <button type="button" className="btn btn--primary auth__submit" onClick={() => void signOutTo(LINK_SIGN_IN_PATH)}>
                {shown.status === "same-account" ? "Sign in to the other login" : "Sign in again"}
              </button>
              <button type="button" className="btn auth__submit" disabled={busy !== null} onClick={() => void cancel()}>Cancel link</button>
            </>
          ) : shown.status !== "already-linked" && (
            <Link className="btn btn--primary auth__submit" to="/account/link">Start again</Link>
          )}
        </div>
      </AuthShell>
    );
  }

  if (!preview || preview.status !== "ready") {
    return <AuthShell title="Confirm the link"><AuthPending>Checking both logins…</AuthPending></AuthShell>;
  }

  return (
    <AuthShell
      title="Link these logins?"
      lede="After linking, signing in with either login opens the workspaces of both."
      stateKey="ready"
    >
      <div className="auth__state">
        <div className="account-link-sides">
          <LinkSideCard heading="Started from" side={preview.initiator} />
          <LinkSideCard heading="Signed in now" side={preview.current} />
        </div>
        <ul className="account-facts">
          <li>Your role in each workspace stays the same.</li>
          <li>Each workspace still asks for its own sign-in steps, like Microsoft or two-factor.</li>
          <li>Both logins keep working on their own. You can unlink them later in Sign-in methods.</li>
        </ul>
        {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
        <div className="auth__actions">
          <button type="button" className={`btn btn--primary auth__submit${busy === "confirm" ? " is-busy" : ""}`} disabled={busy !== null} onClick={() => void confirm(preview)}>
            <BusyLabel busy={busy === "confirm"} busyText="Linking…">Link logins</BusyLabel>
          </button>
          <button type="button" className="btn auth__submit" disabled={busy !== null} onClick={() => void cancel()}>Cancel</button>
        </div>
      </div>
    </AuthShell>
  );
}

function LinkSideCard({ heading, side }: { heading: string; side: LinkSide }) {
  return (
    <section className="account-link-side" aria-label={heading}>
      <h2 className="account-section__title">{heading}</h2>
      <p className="account-link-side__who">
        <strong>{side.email ?? side.name ?? "Unnamed login"}</strong>
        {side.email && side.name && <span className="account-workspace__meta">{side.name}</span>}
      </p>
      {side.workspaces.length ? (
        <ul className="account-link-side__workspaces">
          {side.workspaces.map((workspace) => (
            <li key={`${workspace.name}:${workspace.role}`}>
              {workspace.name} <span className="account-workspace__meta">{workspace.role}{workspace.status !== "Active" ? ` · ${workspace.status}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : <p className="account-workspace__meta">No workspaces</p>}
    </section>
  );
}
