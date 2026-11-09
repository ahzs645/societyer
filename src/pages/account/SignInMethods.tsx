import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useAuth } from "../../auth/AuthProvider";
import { AuthPending, AuthShell, BusyLabel } from "../../auth/AuthShell";
import { useAuthCapabilities } from "../../auth/authCapabilities";
import { authFailureFromResponse, toAuthFailure, type AuthResponseError } from "../../auth/authErrors";
import { appUrl } from "../../auth/microsoftSignIn";
import { MicrosoftLogo } from "../../auth/MicrosoftLogo";
import { useConfirm } from "../../components/Modal";
import { loadSessionAuthClient } from "../../lib/sessionAuthClient";
import { useAccountPage } from "./accountPage";

const PATH = "/account/sign-in-methods";

type SignInAccount = { id: string; providerId: string; accountId: string };
type LinkedIdentity = {
  issuer: string;
  subject: string;
  email?: string;
  name?: string;
  current: boolean;
  linkedAtISO?: string;
  workspaces: Array<{ societyId: string; name: string; role: string; status: string }>;
};

const PROVIDER_LABEL: Record<string, string> = { credential: "Email and password", microsoft: "Microsoft" };

/** Errors Better Auth appends to the link callback as `?error=`. */
function linkErrorMessage(code: string): ReactNode {
  if (code === "account_already_linked_to_different_user") {
    return <>That Microsoft account already belongs to another Societyer login. Use <Link className="auth__link" to="/account/link">Link an existing account</Link> instead.</>;
  }
  if (code === "email_does_not_match" || code === "unable_to_link_account") return "Microsoft couldn't be connected to this login. Contact your administrator.";
  return "Microsoft wasn't connected. Try again.";
}

export default function SignInMethodsPage() {
  const { gate, signOutTo } = useAccountPage("Sign-in methods", PATH);
  return gate ?? <SignInMethods signOutTo={signOutTo} />;
}

function SignInMethods({ signOutTo }: { signOutTo: (target: string) => Promise<void> }) {
  const capabilities = useAuthCapabilities();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<SignInAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ReactNode | null>(() => {
    const code = searchParams.get("error");
    return code ? linkErrorMessage(code) : null;
  });
  const [needsFreshSignIn, setNeedsFreshSignIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => searchParams.get("linked") === "microsoft" ? "Microsoft is connected. You can now sign in with it." : null);

  // `error`, `error_description` and `linked` are one-shot results of the Microsoft round trip.
  useEffect(() => {
    if (!["error", "error_description", "linked"].some((key) => searchParams.has(key))) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      ["error", "error_description", "linked"].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    const { authClient } = await loadSessionAuthClient();
    const result = await authClient.listAccounts();
    if (result.error) throw authFailureFromResponse(result.error, "Your sign-in methods couldn't be loaded.");
    setAccounts((result.data ?? []).map(({ id, providerId, accountId }) => ({ id, providerId, accountId })));
  }, []);
  useEffect(() => {
    load().catch((cause: unknown) => setError(toAuthFailure(cause, "Your sign-in methods couldn't be loaded.").message));
  }, [load]);

  const microsoftAvailable = capabilities?.microsoft?.enabled === true;
  const hasMicrosoft = accounts?.some((account) => account.providerId === "microsoft") ?? false;

  const connectMicrosoft = async () => {
    setBusy("connect");
    setError(null);
    setNotice(null);
    try {
      const { authClient } = await loadSessionAuthClient();
      const result = await authClient.linkSocial({
        provider: "microsoft",
        callbackURL: appUrl(`${PATH}?linked=microsoft`),
        errorCallbackURL: appUrl(PATH),
      });
      if (result.error) throw authFailureFromResponse(result.error, "Microsoft couldn't be connected. Try again.");
    } catch (cause) {
      setError(toAuthFailure(cause, "Microsoft couldn't be connected. Try again.").message);
      setBusy(null);
    }
  };

  const remove = async (account: SignInAccount) => {
    const label = PROVIDER_LABEL[account.providerId] ?? account.providerId;
    const ok = await confirm({
      title: `Remove ${label}?`,
      message: account.providerId === "microsoft"
        ? "You won't be able to sign in with this Microsoft account. Workspaces that need Microsoft sign-in will stay locked until you connect it again."
        : "You won't be able to sign in with your password. Your other sign-in method keeps working.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(account.id);
    setError(null);
    setNotice(null);
    try {
      const { authClient } = await loadSessionAuthClient();
      const result = await authClient.unlinkAccount({ accountId: account.id });
      if (result.error) {
        const failure: AuthResponseError = result.error;
        if (failure.code === "SESSION_NOT_FRESH") {
          setNeedsFreshSignIn(true);
          return;
        }
        if (failure.code === "FAILED_TO_UNLINK_LAST_ACCOUNT") throw new Error("You can't remove your only sign-in method.");
        throw authFailureFromResponse(failure, "That sign-in method couldn't be removed.");
      }
      setNotice(`${label} was removed.`);
      await load();
    } catch (cause) {
      setError(toAuthFailure(cause, "That sign-in method couldn't be removed.").message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthShell
      title="Sign-in methods"
      lede="Ways you can sign in to this login."
      after={<Link to="/account/workspaces" className="auth__link">My workspaces</Link>}
    >
      <div className="auth__state">
        {notice && <p role="status" className="notice notice--success auth__notice">{notice}</p>}
        {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
        {needsFreshSignIn && (
          <div role="alert" className="notice notice--warn auth__notice">
            <p className="auth__error-text">For your security, sign in again before removing a sign-in method.</p>
            <p className="auth__error-actions">
              <button type="button" className="auth__link" onClick={() => void signOutTo(`/login?redirect=${encodeURIComponent(PATH)}`)}>Sign in again</button>
            </p>
          </div>
        )}
        {accounts === null ? <AuthPending>Loading sign-in methods…</AuthPending> : (
          <ul className="account-workspaces" aria-label="Sign-in methods">
            {accounts.map((account) => (
              <li key={account.id} className="account-workspace">
                <span className="account-workspace__text">
                  <strong className="account-workspace__name">{PROVIDER_LABEL[account.providerId] ?? account.providerId}</strong>
                </span>
                {accounts.length > 1 && (
                  <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void remove(account)}>
                    {busy === account.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {microsoftAvailable && accounts !== null && !hasMicrosoft && (
          <button type="button" className={`btn auth__submit auth__sso${busy === "connect" ? " is-busy" : ""}`} disabled={busy !== null} onClick={() => void connectMicrosoft()}>
            <BusyLabel busy={busy === "connect"} busyText="Opening Microsoft…"><MicrosoftLogo /> Connect Microsoft</BusyLabel>
          </button>
        )}
        <LinkedLogins />
      </div>
    </AuthShell>
  );
}

/** Other logins linked to this one through `accountLinks` (separate Better Auth users). */
function LinkedLogins() {
  const auth = useAuth();
  const confirm = useConfirm();
  const overview = useQuery(api.accountLinks.overview, auth.isConvexAuthenticated ? {} : "skip") as { identities: LinkedIdentity[] } | undefined;
  const unlink = useMutation(api.accountLinks.unlink);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const others = overview?.identities.filter((identity) => !identity.current) ?? [];

  return (
    <section className="account-section" aria-labelledby="account-linked-logins">
      <h2 id="account-linked-logins" className="account-section__title">Linked logins</h2>
      {overview === undefined ? <AuthPending>Loading linked logins…</AuthPending> : others.length === 0 ? (
        <p className="auth__hint">No other logins are linked. <Link className="auth__link" to="/account/link">Link an existing account</Link></p>
      ) : (
        <ul className="account-workspaces" aria-label="Linked logins">
          {others.map((identity) => {
            const key = `${identity.issuer} ${identity.subject}`;
            const label = identity.email ?? identity.name ?? "Another login";
            return (
              <li key={key} className="account-workspace">
                <span className="account-workspace__text">
                  <strong className="account-workspace__name">{label}</strong>
                  <span className="account-workspace__meta">
                    {identity.workspaces.length ? identity.workspaces.map((workspace) => `${workspace.name} (${workspace.role})`).join(", ") : "No workspaces"}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Unlink ${label}?`,
                      message: "Its workspaces will no longer open from this login. That login keeps working on its own, and no roles change.",
                      confirmLabel: "Unlink",
                      tone: "danger",
                    });
                    if (!ok) return;
                    setBusy(key);
                    setMessage(null);
                    try {
                      const result = await unlink({ issuer: identity.issuer, subject: identity.subject }) as { status: string };
                      setMessage(result.status === "unlinked"
                        ? { tone: "success", text: `${label} is no longer linked.` }
                        : { tone: "danger", text: "That login wasn't linked any more." });
                      auth.refreshMembership();
                    } catch (cause) {
                      setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : "That login couldn't be unlinked." });
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === key ? "Unlinking…" : "Unlink"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {message && <p role={message.tone === "danger" ? "alert" : "status"} className={`notice notice--${message.tone} auth__notice`}>{message.text}</p>}
    </section>
  );
}
