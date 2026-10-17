import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { loadSessionAuthClient } from "../lib/sessionAuthClient";

/** Landing page for a password-reset email link (Convex-hosted sign-in). */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") ? "This reset link is invalid or has expired. Request a new one from the sign-in page." : null,
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !token) return;
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { authClient } = await loadSessionAuthClient();
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) throw new Error(result.error.message || "The password could not be changed");
      navigate("/login?reset=1", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The password could not be changed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ minHeight: "100vh" }}>
        <div className="landing__container" style={{ maxWidth: 520 }}>
          <div className="landing__eyebrow"><KeyRound size={12} /> Account recovery</div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>Choose a new password</h1>
          <form onSubmit={onSubmit} className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
            {token && !searchParams.get("error") && (
              <>
                <label className="field">
                  <span className="field__label">New password</span>
                  <input className="input" type="password" minLength={10} value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
                </label>
                <label className="field">
                  <span className="field__label">Confirm new password</span>
                  <input className="input" type="password" minLength={10} value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
                </label>
              </>
            )}
            {!token && !error && <p style={{ margin: 0 }}>This reset link is incomplete. Open the link from your email again.</p>}
            {error && <div role="alert" style={{ color: "var(--danger)" }}>{error}</div>}
            {token && !searchParams.get("error") && (
              <button className="landing__btn landing__btn--primary" disabled={busy}>
                {busy ? "Please wait…" : "Change password"}
              </button>
            )}
            <Link to="/login" className="landing__btn landing__btn--ghost">Back to sign in</Link>
          </form>
        </div>
      </section>
    </div>
  );
}
