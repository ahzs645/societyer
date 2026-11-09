import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useAuth } from "../../auth/AuthProvider";
import { AuthPending, AuthShell } from "../../auth/AuthShell";
import { useAuthCapabilities } from "../../auth/authCapabilities";
import { authFailureFromResponse, toAuthFailure } from "../../auth/authErrors";
import { useConfirm } from "../../components/Modal";
import { loadSessionAuthClient } from "../../lib/sessionAuthClient";
import { useAccountPage } from "./accountPage";

const PATH = "/account/sign-in-methods";

type SignInAccount = { id: string; providerId: string };
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

export default function SignInMethodsPage() {
  const { gate } = useAccountPage("Sign-in methods", PATH);
  return gate ?? <SignInMethods />;
}

/**
 * Read-only on purpose: Better Auth provider linking is off (see the
 * accountLinking note in convex/hostedAuth.ts). Another login is connected
 * with person-level linking instead, which proves each login separately.
 */
function SignInMethods() {
  const capabilities = useAuthCapabilities();
  const [accounts, setAccounts] = useState<SignInAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadSessionAuthClient().then(async ({ authClient }) => {
      const result = await authClient.listAccounts();
      if (result.error) throw authFailureFromResponse(result.error, "Your sign-in methods couldn't be loaded.");
      if (active) setAccounts((result.data ?? []).map(({ id, providerId }) => ({ id, providerId })));
    }).catch((cause: unknown) => {
      if (active) setError(toAuthFailure(cause, "Your sign-in methods couldn't be loaded.").message);
    });
    return () => { active = false; };
  }, []);

  const microsoftAvailable = capabilities?.microsoft?.enabled === true;
  const hasMicrosoft = accounts?.some((account) => account.providerId === "microsoft") ?? false;

  return (
    <AuthShell
      title="Sign-in methods"
      lede="Ways you can sign in to this login."
      after={<Link to="/account/workspaces" className="auth__link">My workspaces</Link>}
    >
      <div className="auth__state">
        {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
        {accounts === null ? (error ? null : <AuthPending>Loading sign-in methods…</AuthPending>) : (
          <ul className="account-workspaces" aria-label="Sign-in methods">
            {accounts.map((account) => (
              <li key={account.id} className="account-workspace">
                <span className="account-workspace__text">
                  <strong className="account-workspace__name">{PROVIDER_LABEL[account.providerId] ?? account.providerId}</strong>
                </span>
              </li>
            ))}
          </ul>
        )}
        {microsoftAvailable && accounts !== null && !hasMicrosoft && (
          <p className="auth__hint">
            To sign in with Microsoft, ask your administrator to set up a Microsoft login for you. Then
            connect it here with <Link className="auth__link" to="/account/link">Link an existing account</Link>.
          </p>
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
