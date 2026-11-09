import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useAuth } from "../../auth/AuthProvider";
import { AuthShell, BusyLabel } from "../../auth/AuthShell";
import { saveLinkCode } from "./accountLinkCode";
import { LINK_SIGN_IN_PATH, useAccountPage } from "./accountPage";

const PATH = "/account/link";

type BeginResult =
  | { status: "started"; code: string; expiresAtISO: string }
  | { status: "reauthentication-required" }
  | { status: "identity-disabled" }
  | { status: "unauthenticated" };

/**
 * Step 1 of "Link an existing account" (docs/shared-workspaces/architecture.md,
 * "Link protocol"): this fresh session asks for a code, keeps it in this tab
 * only, signs out, and the person signs in to the other login.
 */
export default function LinkAccountPage() {
  const { gate, signOutTo } = useAccountPage("Link an existing account", PATH);
  return gate ?? <LinkAccount signOutTo={signOutTo} />;
}

function LinkAccount({ signOutTo }: { signOutTo: (target: string) => Promise<void> }) {
  const auth = useAuth();
  const begin = useMutation(api.accountLinks.begin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFreshSignIn, setNeedsFreshSignIn] = useState(false);
  const email = auth.session?.user.email;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await begin({}) as BeginResult;
      if (result.status === "started") {
        saveLinkCode({ code: result.code, expiresAtISO: result.expiresAtISO });
        await signOutTo(LINK_SIGN_IN_PATH);
        return;
      }
      if (result.status === "reauthentication-required") setNeedsFreshSignIn(true);
      else if (result.status === "identity-disabled") setError("This login is disabled. Contact your administrator.");
      else setError("The link couldn't be started. Sign in again and try once more.");
    } catch (cause) {
      console.error("[societyer-auth] account link could not start", cause);
      setError("The link couldn't be started. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (needsFreshSignIn) {
    return (
      <AuthShell
        title="Sign in again first"
        lede={`For your security, linking needs a recent sign-in. Sign in again as ${email ?? "this account"}, then start the link.`}
        stateKey="reauthenticate"
        after={<Link to="/account/workspaces" className="auth__link">Not now</Link>}
      >
        <button type="button" className="btn btn--primary auth__submit" onClick={() => void signOutTo(`/login?redirect=${encodeURIComponent(PATH)}`)}>
          Sign in again
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Link an existing account"
      lede="Use this if you joined another workspace with a different login. After linking, signing in with either login opens the workspaces of both."
      stateKey="start"
      after={<Link to="/account/workspaces" className="auth__link">Back to My workspaces</Link>}
    >
      <div className="auth__state">
        <ol className="account-steps">
          <li>We sign you out of {email ?? "this login"}.</li>
          <li>You sign in to the other login, the way its workspace requires.</li>
          <li>You check both accounts and confirm. You have 10 minutes.</li>
        </ol>
        <p className="auth__hint">Roles don't change, nothing is merged, and each workspace still asks for its own sign-in steps.</p>
        {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
        <button type="button" className={`btn btn--primary auth__submit${busy ? " is-busy" : ""}`} disabled={busy || !auth.isConvexAuthenticated} onClick={() => void start()}>
          <BusyLabel busy={busy} busyText="Starting…">Continue</BusyLabel>
        </button>
      </div>
    </AuthShell>
  );
}
