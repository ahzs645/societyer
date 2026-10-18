import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../auth/AuthShell";
import { AuthFailure, authFailureFromResponse, toAuthFailure } from "../auth/authErrors";
import { PasswordField } from "../auth/PasswordField";
import { loadSessionAuthClient } from "../lib/sessionAuthClient";

const MIN_PASSWORD_LENGTH = 10;

/** Landing page for a password-reset email link (Convex-hosted sign-in). */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  // Better Auth redirects here with `?error=INVALID_TOKEN` for an expired or
  // used link; the server can also reject the token on submit.
  const [tokenRejected, setTokenRejected] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusAfterError = useRef(false);

  // The fields are disabled while busy; move focus to the error once they are live again.
  useEffect(() => {
    if (busy || !error || !focusAfterError.current) return;
    focusAfterError.current = false;
    errorRef.current?.focus();
  }, [busy, error]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !token) return;
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
        setTokenRejected(true);
        return;
      }
      focusAfterError.current = true;
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const linkUsable = Boolean(token) && !searchParams.get("error") && !tokenRejected;

  if (!linkUsable) {
    // Better Auth sends `?error=INVALID_TOKEN` without a token for a dead link.
    const lede = token || searchParams.get("error")
      ? "It may have expired or already been used. Reset links work once, for one hour."
      : "Part of the link is missing. Open it from your email again, or ask for a new one.";
    return (
      <AuthShell
        title="This reset link doesn't work"
        lede={lede}
        stateKey="link-broken"
        after={<p><Link to="/login" className="auth__link">Back to sign in</Link></p>}
      >
        <Link to="/login?mode=forgot" className="btn btn--primary auth__submit">Send a new link</Link>
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
