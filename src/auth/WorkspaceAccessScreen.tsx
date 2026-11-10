import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { AuthShell, BusyLabel } from "./AuthShell";
import { useAuth, type LockedWorkspace } from "./AuthProvider";
import { MicrosoftLogo } from "./MicrosoftLogo";
import { startMicrosoftSignIn } from "./microsoftSignIn";
import { rememberStartupWorkspace } from "./startupWorkspace";
import { toAuthFailure } from "./authErrors";
import { authEmailDomainHint } from "./authCapabilities";
import { WorkspaceList } from "./WorkspaceList";
import { WorkspaceMfaActions } from "./WorkspaceMfaActions";
import { RequestWorkspaceAccess } from "./RequestWorkspaceAccess";
import type { DomainWorkspace } from "../lib/workspaceDomain";

/**
 * Shown instead of the app when sign-in opened a workspace this session can't
 * use yet (its lock screen), or the domain's workspace isn't one of the
 * person's (docs/shared-workspaces/architecture.md, startup rules 3 and 4).
 */
export default function WorkspaceAccessScreen() {
  const auth = useAuth();
  const startup = auth.startup;
  if (startup?.kind === "locked") return <LockedScreen workspace={startup.workspace} />;
  if (startup?.kind === "no-access-here") return <NoAccessHere workspace={startup.domainWorkspace} />;
  // No workspace at all yet, on a domain whose workspace takes access requests (see AuthGate).
  if (auth.membershipStatus === "needs-invitation" && auth.domainWorkspace) return <NoAccessHere workspace={auth.domainWorkspace} />;
  return (
    <AuthShell title="Workspace locked" lede="This sign-in can't open any of your workspaces yet.">
      <div className="auth__state">
        <WorkspaceList showLabel label="Your workspaces" memberships={[]} locked={auth.lockedWorkspaces} />
        <UseAnotherAccount />
      </div>
    </AuthShell>
  );
}

function NoAccessHere({ workspace }: { workspace: DomainWorkspace }) {
  const auth = useAuth();
  const name = workspace.workspaceName;
  const memberships = auth.memberships ?? [];
  const elsewhere = memberships.length + auth.lockedWorkspaces.length > 0;
  return (
    <AuthShell
      title={`No access to ${name}`}
      lede={`You're signed in as ${auth.session?.user.email ?? "another account"}, which isn't a member of ${name}.${
        elsewhere ? " You can open your own workspaces below." : ""}`}
    >
      <div className="auth__state">
        {/* Each Open button carries this session to that workspace's own website. */}
        <WorkspaceList showLabel label="Your workspaces" memberships={memberships} locked={auth.lockedWorkspaces} />
        <section className="account-section" aria-label={`Add your ${name} login`}>
          <p className="auth__hint">Joined {name} with a different login? Add that login once, and either one opens both workspaces.</p>
          <Link className="btn btn--primary auth__submit" to="/account/link"><UserPlus size={14} /> Add your {name} login</Link>
        </section>
        <RequestWorkspaceAccess societyId={workspace.societyId} workspaceName={name} />
        <UseAnotherAccount />
      </div>
    </AuthShell>
  );
}

function LockedScreen({ workspace }: { workspace: LockedWorkspace }) {
  const auth = useAuth();
  const reason = workspace.reason ?? "mfa";
  const others = (
    <WorkspaceList
      showLabel
      label="Your other workspaces"
      memberships={auth.memberships ?? []}
      locked={auth.lockedWorkspaces}
      exclude={workspace.id}
    />
  );
  const support = workspace.supportEmail && (
    <p className="auth__hint">
      Questions? Contact <a className="auth__help-link" href={`mailto:${workspace.supportEmail}`}>{workspace.supportEmail}</a>.
    </p>
  );

  if (reason === "microsoft") {
    return (
      <AuthShell
        title="Sign in with Microsoft"
        lede={auth.sessionMicrosoft
          ? `Your current Microsoft sign-in doesn't give access to ${workspace.name}. Use the Microsoft account ${workspace.name} gave you.`
          : `${workspace.name} needs you to sign in with your Microsoft work account.`}
      >
        <div className="auth__state">
          <MicrosoftContinue workspace={workspace} />
          {support}
          {others}
        </div>
      </AuthShell>
    );
  }

  if (reason === "email-domain") {
    return (
      <AuthShell
        title={`Use your ${workspace.name} email`}
        lede={`${workspace.name} doesn't accept sign-in as ${auth.session?.user.email ?? "this account"}. ${
          workspace.allowedEmailDomains?.length
            ? `${authEmailDomainHint(workspace.allowedEmailDomains)} instead.`
            : `Sign in with the email address ${workspace.name} gave you.`}`}
      >
        <div className="auth__state">
          <UseAnotherAccount primary workspaceId={workspace.id} />
          {support}
          {others}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Two-factor authentication required"
      lede={`Verify a second factor to open ${workspace.name}. Set it up in your account, or sign in again if it's already set up.`}
    >
      <div className="auth__state">
        <WorkspaceMfaActions />
        {support}
        {others}
      </div>
    </AuthShell>
  );
}

function MicrosoftContinue({ workspace }: { workspace: LockedWorkspace }) {
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("sso") === "failed" ? "Microsoft sign-in was not completed. Try again." : null,
  );
  return (
    <>
      <button
        type="button"
        className={`btn auth__submit auth__sso${busy ? " is-busy" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            // Reopen this workspace when Microsoft sends the browser back.
            rememberStartupWorkspace(workspace.id);
            await startMicrosoftSignIn({ redirect: "/app", errorRedirect: "/app?sso=failed" });
          } catch (cause) {
            setError(toAuthFailure(cause, "Microsoft sign-in failed. Try again.").message);
            setBusy(false);
          }
        }}
      >
        <BusyLabel busy={busy} busyText="Opening Microsoft…">
          <MicrosoftLogo /> Continue with Microsoft for {workspace.name}
        </BusyLabel>
      </button>
      {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
    </>
  );
}

function UseAnotherAccount({ primary = false, workspaceId }: { primary?: boolean; workspaceId?: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={`btn auth__submit${primary ? " btn--primary" : ""}`}
      onClick={async () => {
        await auth.signOut();
        // signOut clears pending choices; keep this one for the next sign-in.
        if (workspaceId) rememberStartupWorkspace(workspaceId);
        navigate("/login", { replace: true });
      }}
    >
      Use another account
    </button>
  );
}
