import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useAuth } from "../../auth/AuthProvider";
import { AuthShell, BusyLabel } from "../../auth/AuthShell";
import { saveLinkCode } from "./accountLinkCode";
import { LINK_SIGN_IN_PATH, useAccountPage } from "./accountPage";

const PATH = "/account/link";
/** Back here after the fresh sign-in that `begin` asked for: start the link without another click. */
const RESUME_PATH = `${PATH}?resume=1`;

type BeginResult =
  | { status: "started"; code: string; expiresAtISO: string }
  | { status: "reauthentication-required" }
  | { status: "identity-disabled" }
  | { status: "unauthenticated" };

/**
 * Step 1 of "Add another account" (linking) (docs/shared-workspaces/architecture.md,
 * "Link protocol"): this fresh session asks for a code, keeps it in this tab
 * only, signs out, and the person signs in to the other login.
 */
export default function LinkAccountPage() {
  const { gate, signOutTo } = useAccountPage("Add another account", PATH);
  return gate ?? <LinkAccount signOutTo={signOutTo} />;
}

function LinkAccount({ signOutTo }: { signOutTo: (target: string) => Promise<void> }) {
  const auth = useAuth();
  const begin = useMutation(api.accountLinks.begin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFreshSignIn, setNeedsFreshSignIn] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const resumed = useRef(false);
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

  // The person already chose Continue before signing in again; once only, so a
  // still-stale session shows "Sign in again first" instead of looping.
  const resume = searchParams.get("resume") === "1";
  useEffect(() => {
    if (!resume || resumed.current || !auth.isConvexAuthenticated) return;
    resumed.current = true;
    setSearchParams({}, { replace: true });
    void start();
  });

  if (needsFreshSignIn) {
    return (
      <AuthShell
        title="Sign in again first"
        lede={`For your security, adding an account needs a recent sign-in. Sign in again as ${email ?? "this account"} and the link continues on its own.`}
        stateKey="reauthenticate"
        after={<Link to="/account/workspaces" className="auth__link">Not now</Link>}
      >
        <button type="button" className="btn btn--primary auth__submit" onClick={() => void signOutTo(`/login?redirect=${encodeURIComponent(RESUME_PATH)}`)}>
          Sign in again
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Add another account"
      lede="Use this when you joined another workspace with a different login, even one on another website. Afterwards either login shows the workspaces of both, and the workspace menu switches between them."
      stateKey="start"
      after={<Link to="/account/workspaces" className="auth__link">Back to My workspaces</Link>}
    >
      <div className="auth__state">
        <ol className="account-steps">
          <li>We sign you out of {email ?? "this login"} in this tab.</li>
          <li>You sign in to the other login here, the way its workspace requires (password or Microsoft).</li>
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
