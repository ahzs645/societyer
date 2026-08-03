import { FormEvent, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/authClient";
import { useAuth } from "../auth/AuthProvider";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(
    () => (mode === "sign-in" ? "Sign in" : "Create your account"),
    [mode],
  );

  if (auth.mode !== "better-auth") {
    return <Navigate to="/app" replace />;
  }
  const redirect = searchParams.get("redirect");
  const safeRedirect = redirect?.startsWith("/") && !redirect.startsWith("//")
    ? redirect
    : "/app";
  if (auth.session && redirect) {
    return <Navigate to={safeRedirect} replace />;
  }
  if (auth.isAuthenticated) {
    return <Navigate to={safeRedirect} replace />;
  }
  if (auth.session && auth.membershipStatus === "needs-invitation") {
    return (
      <div className="page">
        <h1>Invitation required</h1>
        <p>Open the invitation link sent by your workspace administrator.</p>
        <button className="btn" type="button" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        await authClient.signIn.email({
          email,
          password,
        });
      } else {
        await authClient.signUp.email({
          name,
          email,
          password,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ minHeight: "100vh" }}>
        <div className="landing__container" style={{ maxWidth: 520 }}>
          <div className="landing__eyebrow">
            <LockKeyhole size={12} /> Better Auth member and staff access
          </div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>
            {title}
          </h1>
          <p className="landing__lede" style={{ marginBottom: 24 }}>
            Staff and members authenticate here. Societyer then maps that
            identity into the society workspace and member portal.
          </p>

          <form
            onSubmit={onSubmit}
            className="card"
            style={{ padding: 20, display: "grid", gap: 14 }}
          >
            {mode === "sign-up" && (
              <label className="field">
                <span className="field__label">Full name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            )}

            <label className="field">
              <span className="field__label">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="input"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                required
              />
            </label>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  border: "1px solid var(--danger)",
                  borderRadius: 8,
                  padding: 10,
                  color: "var(--danger)",
                  background: "rgba(196, 55, 55, 0.08)",
                }}
              >
                {error}
              </div>
            )}

            <button className="landing__btn landing__btn--primary" disabled={busy}>
              {busy ? "Please wait…" : title} <ArrowRight size={14} />
            </button>

            <button
              type="button"
              className="landing__btn landing__btn--ghost"
              onClick={() => {
                setError(null);
                setMode((current) =>
                  current === "sign-in" ? "sign-up" : "sign-in",
                );
              }}
            >
              {mode === "sign-in"
                ? "Need an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
            {mode === "sign-in" && (
              <p className="muted" style={{ margin: 0, textAlign: "center" }}>
                Contact your workspace administrator to reset your password.
              </p>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
