import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthPending, AuthShell } from "../auth/AuthShell";
import { useAuth } from "../auth/AuthProvider";
import { useAuthCapabilities } from "../auth/authCapabilities";
import { AuthFailure, authFailureFromResponse, toAuthFailure } from "../auth/authErrors";
import { PasswordField } from "../auth/PasswordField";
import { loadSessionAuthClient } from "../lib/sessionAuthClient";

const MIN_PASSWORD_LENGTH = 10;

/** Landing page for a password-reset or operator-issued setup link. */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const token = searchParams.get("token") ?? new URLSearchParams(hash.slice(1)).get("token");
  return <ResetPasswordFlow key={token} token={token} linkError={searchParams.has("error")} />;
}

function ResetPasswordFlow({ token, linkError }: { token: string | null; linkError: boolean }) {
  const navigate = useNavigate();
  const { mode } = useAuth();
  const capabilities = useAuthCapabilities();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const [check, setCheck] = useState<"checking" | "valid" | "invalid" | AuthFailure>("checking");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusAfterError = useRef(false);

  useEffect(() => {
    if (!token || linkError || token.length > 512) return;
    const controller = new AbortController();
    const fallback = "We couldn't check this link. Try again.";
    void (async () => {
      try {
        const { authClient } = await loadSessionAuthClient();
        if (controller.signal.aborted) return;
        const result = await authClient.$fetch<{ valid: boolean }>("/check-password-reset-link", {
          method: "POST", body: { token }, signal: controller.signal, timeout: 10_000,
        });
        if (result.error) throw authFailureFromResponse(result.error, fallback);
        if (typeof result.data?.valid !== "boolean") throw new AuthFailure("other", fallback);
        if (!controller.signal.aborted) setCheck(result.data.valid ? "valid" : "invalid");
      } catch (cause) {
        if (!controller.signal.aborted) setCheck(toAuthFailure(cause, fallback));
      }
    })();
    return () => controller.abort();
  }, [token, linkError, checkAttempt]);

  // The fields are disabled while busy; move focus to the error once they are live again.
  useEffect(() => {
    if (busy || !error || !focusAfterError.current) return;
    focusAfterError.current = false;
    errorRef.current?.focus();
  }, [busy, error]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !token || check !== "valid") return;
    if (password !== confirm) {
      focusAfterError.current = true;
      setError(new AuthFailure("other", "The passwords don't match."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { authClient } = await loadSessionAuthClient();
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        throw authFailureFromResponse(result.error, "The password could not be changed.", { minPasswordLength: MIN_PASSWORD_LENGTH });
      }
      navigate("/login?reset=1", { replace: true });
    } catch (err: unknown) {
      const failure = toAuthFailure(err, "The password could not be changed.");
      if (failure.kind === "invalid-token") {
        setPassword("");
        setConfirm("");
        setCheck("invalid");
        return;
      }
      focusAfterError.current = true;
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  if (!token || linkError || token.length > 512 || check === "invalid") {
    // Better Auth sends `?error=INVALID_TOKEN` without a token for a dead link.
    const lede = token || linkError
      ? "It may have expired or already been used. Reset links work once, for one hour."
      : "Part of the link is missing. Open it from your email again, or ask for a new one.";
    return (
      <AuthShell
        title="This reset link doesn't work"
        lede={lede}
        stateKey="link-broken"
        after={<p><Link to="/login" className="auth__link">Back to sign in</Link></p>}
      >
        {mode === "convex" && capabilities?.emailDelivery !== true
          ? <p>Ask your workspace administrator for a new link if you still need one.</p>
          : <Link to="/login?mode=forgot" className="btn btn--primary auth__submit">Send a new link</Link>}
      </AuthShell>
    );
  }

  if (check === "checking") {
    return <AuthShell title="Checking your link"><AuthPending>One moment…</AuthPending></AuthShell>;
  }

  if (check instanceof AuthFailure) {
    return (
      <AuthShell title="Couldn't check your link" lede={check.message}
        after={<p><Link to="/login" className="auth__link">Back to sign in</Link></p>}
      >
        <button className="btn btn--primary auth__submit" type="button" onClick={() => {
          setCheck("checking");
          setCheckAttempt(attempt => attempt + 1);
        }}>Try again</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      lede={`Pick a password with at least ${MIN_PASSWORD_LENGTH} characters. You'll sign in with it next.`}
      stateKey="form"
      after={<p><Link to="/login" className="auth__link">Back to sign in</Link></p>}
    >
      <form onSubmit={onSubmit} className="auth__form">
        <fieldset className="auth__fieldset" disabled={busy}>
          <PasswordField label="New password" minLength={MIN_PASSWORD_LENGTH} value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" enterKeyHint="next" required />
          <PasswordField label="Confirm new password" minLength={MIN_PASSWORD_LENGTH} value={confirm}
            onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" enterKeyHint="go" required />
          {error && (
            <div ref={errorRef} role="alert" tabIndex={-1} className="notice notice--danger auth__notice auth__error">
              {error.message}
            </div>
          )}
          <button type="submit" className={`btn btn--primary auth__submit${busy ? " is-busy" : ""}`}>
            <span className="auth__submit-label" aria-hidden={busy || undefined}>Change password</span>
            {busy && (
              <>
                <span className="spinner spinner--md auth__submit-spinner" aria-hidden="true" />
                <span className="sr-only">Please wait…</span>
              </>
            )}
          </button>
        </fieldset>
      </form>
    </AuthShell>
  );
}
