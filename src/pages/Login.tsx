import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { getSafeAuthRedirect } from "../lib/authRedirect";
import { ArrowRight, LockKeyhole } from "lucide-react";

const ClerkLogin = lazy(() => import("../auth/ClerkLogin"));

export function LoginPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"email" | "microsoft" | null>(null);
  const [error, setError] = useState<string | null>(() =>
    searchParams.get("sso") === "failed"
      ? "Microsoft sign-in was not completed. Please try again."
      : null,
  );
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);

  useEffect(() => {
    if (auth.mode !== "better-auth") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { authClient } = await import("../lib/authClient");
        if (controller.signal.aborted) return;
        const { data } = await authClient.$fetch<{
          mode: string;
          microsoft: { enabled: boolean };
        }>("/providers", { signal: controller.signal });
        if (!controller.signal.aborted) {
          setMicrosoftEnabled(data?.mode === "better-auth" && data.microsoft?.enabled === true);
        }
      } catch {
        // An unavailable provider endpoint leaves email sign-in usable.
        if (!controller.signal.aborted) setMicrosoftEnabled(false);
      }
    })();
    return () => controller.abort();
  }, [auth.mode]);

  const title = useMemo(
    () => (mode === "sign-in" ? "Sign in" : "Create your account"),
    [mode],
  );

  if (auth.mode === "none") {
    return <Navigate to="/app" replace />;
  }
  const redirect = searchParams.get("redirect");
  const safeRedirect = getSafeAuthRedirect(redirect);
  if (auth.isAuthenticated) {
    return <Navigate to={safeRedirect} replace />;
  }
  if (auth.fatalError) {
    return (
      <div className="page">
        <h1>{auth.fatalError.kind === "expired-session" ? "Session expired" : "Sign-in unavailable"}</h1>
        <p>{auth.fatalError.message}</p>
        {auth.fatalError.retryable && (
          <button className="btn" type="button" onClick={auth.retryAuthentication}>Retry</button>
        )}
      </div>
    );
  }
  if (auth.session && redirect && auth.membershipState === "ready") {
    return <Navigate to={safeRedirect} replace />;
  }
  if (
    auth.session &&
    auth.membershipState === "ready" &&
    auth.membershipStatus === "needs-invitation"
  ) {
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

  if (auth.mode === "clerk") {
    if (auth.sessionStatus === "loading") return <div className="page">Checking your session…</div>;
    if (auth.session) {
      return <Navigate to={safeRedirect} replace />;
    }
    return (
      <div className="landing" style={{ minHeight: "100vh" }}>
        <section className="landing__hero" style={{ minHeight: "100vh" }}>
          <div className="landing__container" style={{ maxWidth: 520 }}>
            <h1 className="landing__h1">Sign in to Societyer</h1>
            <p className="landing__lede">Use your account to access your workspace.</p>
            <Suspense fallback={<p>Loading sign-in…</p>}>
              <ClerkLogin redirect={safeRedirect} />
            </Suspense>
          </div>
        </section>
      </div>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy("email");
    setError(null);
    try {
      const { authClient } = await import("../lib/authClient");
      const result = mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password });
      if (result.error) throw new Error(result.error.message || "Authentication failed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(null);
    }
  };

  const signInWithMicrosoft = async () => {
    if (busy || !microsoftEnabled) return;
    setBusy("microsoft");
    setError(null);
    try {
      const { authClient } = await import("../lib/authClient");
      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
      const callbackURL = new URL(`${basePath}${safeRedirect}`, window.location.origin).href;
      const errorCallbackURL = new URL(`${basePath}/login`, window.location.origin);
      errorCallbackURL.searchParams.set("redirect", safeRedirect);
      errorCallbackURL.searchParams.set("sso", "failed");
      const result = await authClient.signIn.social({
        provider: "microsoft",
        callbackURL,
        errorCallbackURL: errorCallbackURL.href,
      });
      if (result.error) throw new Error(result.error.message || "Microsoft sign-in failed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Microsoft sign-in failed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ minHeight: "100vh" }}>
        <div className="landing__container" style={{ maxWidth: 520 }}>
          <div className="landing__eyebrow">
            <LockKeyhole size={12} /> Member and staff access
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
            {microsoftEnabled && (
              <button
                type="button"
                className="landing__btn landing__btn--ghost"
                disabled={busy !== null}
                onClick={() => void signInWithMicrosoft()}
              >
                {busy === "microsoft" ? "Opening Microsoft…" : "Continue with Microsoft"}
              </button>
            )}
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

            <button className="landing__btn landing__btn--primary" disabled={busy !== null}>
              {busy === "email" ? "Please wait…" : title} <ArrowRight size={14} />
            </button>

            <button
              type="button"
              className="landing__btn landing__btn--ghost"
              disabled={busy !== null}
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
