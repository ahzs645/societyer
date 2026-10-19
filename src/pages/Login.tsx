import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../lib/convexApi";
import { useAuth } from "../auth/AuthProvider";
import { AuthPending, AuthShell, BusyLabel } from "../auth/AuthShell";
import { CheckEmailBody, checkEmailShell, type SentState } from "../auth/CheckEmail";
import { authEmailDomainHint, useAuthCapabilities } from "../auth/authCapabilities";
import { AuthFailure, authFailureFromResponse, toAuthFailure } from "../auth/authErrors";
import { PasswordField } from "../auth/PasswordField";
import { getSafeAuthRedirect } from "../lib/authRedirect";
import { loadSessionAuthClient } from "../lib/sessionAuthClient";
import { authEmailAllowed, authEmailPolicyMessage } from "../../shared/authEmailPolicy";

const ClerkLogin = lazy(() => import("../auth/ClerkLogin"));

type Mode = "sign-in" | "sign-up" | "forgot";

const SIGN_UP_UNAVAILABLE = "Sign-up is temporarily unavailable while email verification is being configured.";

/** Absolute app URL for links in auth emails; the auth server is on another origin. */
function appUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return new URL(`${basePath}${path}`, window.location.origin).href;
}

export function LoginPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();

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
      <AuthShell
        title={auth.fatalError.kind === "expired-session" ? "Session expired" : "Sign-in unavailable"}
        lede={auth.fatalError.message}
        help="Trouble signing in?"
      >
        {auth.fatalError.retryable && (
          <button className="btn btn--primary auth__submit" type="button" onClick={auth.retryAuthentication}>
            Try again
          </button>
        )}
      </AuthShell>
    );
  }
  if (auth.isPending) {
    return <AuthShell title="Signing you in"><AuthPending>Checking your secure workspace access…</AuthPending></AuthShell>;
  }
  if (auth.session && redirect && auth.membershipState === "ready") {
    return <Navigate to={safeRedirect} replace />;
  }
  if (
    auth.session &&
    auth.convexAuthStatus === "authenticated" &&
    auth.membershipState === "ready" &&
    auth.membershipStatus === "needs-invitation"
  ) {
    return <Navigate to={safeRedirect} replace />;
  }

  if (auth.mode === "clerk") {
    if (auth.sessionStatus === "loading") {
      return (
        <AuthShell title="Sign in">
          <AuthPending>Checking your session…</AuthPending>
        </AuthShell>
      );
    }
    if (auth.session) {
      return <Navigate to={safeRedirect} replace />;
    }
    return (
      <AuthShell title="Sign in to Societyer" lede="Use your account to access your workspace." variant="plain">
        <Suspense fallback={<AuthPending>Loading sign-in…</AuthPending>}>
          <ClerkLogin redirect={safeRedirect} />
        </Suspense>
      </AuthShell>
    );
  }

  return <EmailSignIn safeRedirect={safeRedirect} />;
}

function EmailSignIn({ safeRedirect }: { safeRedirect: string }) {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // `?mode=sign-up` / `?mode=forgot` select the form, as in ClerkLogin, so a
  // link (e.g. "Send a new link" on a dead reset link) can open the right one.
  const requestedMode = parseMode(searchParams.get("mode"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const invitationToken = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(safeRedirect)?.[1];
  const invitation = useQuery(api.invitations.getByToken, invitationToken ? { token: invitationToken } : "skip");
  const prefilledInvitation = useRef<string | null>(null);
  useEffect(() => {
    if (!invitation?.email || !invitationToken || prefilledInvitation.current === invitationToken) return;
    prefilledInvitation.current = invitationToken;
    setEmail(current => current || invitation.email);
  }, [invitation, invitationToken]);
  const [busy, setBusy] = useState<"email" | "microsoft" | "resend" | null>(null);
  const [error, setError] = useState<AuthFailure | null>(() =>
    searchParams.get("sso") === "failed"
      ? new AuthFailure("other", "Microsoft sign-in was not completed. Please try again.")
      : null,
  );
  const [notice, setNotice] = useState<string | null>(() =>
    searchParams.get("verified") === "1"
      ? "Your email is verified. Sign in to continue."
      : searchParams.get("reset") === "1"
        ? "Your password was changed. Sign in with the new password."
        : null,
  );
  // After a link is emailed, the form gives way to a "Check your email" state.
  const [sent, setSent] = useState<SentState | null>(null);
  const [resent, setResent] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);
  // Convex-hosted sign-in can only verify emails and reset passwords when the
  // deployment has a mail sender configured.
  const capabilities = useAuthCapabilities();
  const emailDelivery = capabilities?.emailDelivery === true;
  const allowedEmailDomains = useMemo(() => capabilities?.allowedEmailDomains ?? [], [capabilities]);
  const signUpUnavailable = auth.mode === "convex" && (!capabilities || !capabilities.signUpEnabled);
  const canResetByEmail = auth.mode === "convex" && emailDelivery;
  // Hold `?mode=forgot` until capabilities load, then fall back if there is no mail.
  const mode: Mode = requestedMode === "forgot" && (auth.mode !== "convex" || capabilities?.emailDelivery === false)
    ? "sign-in"
    : requestedMode;
  const passwordMinLength = auth.mode === "convex" && mode === "sign-up" ? 10 : 8;

  const errorRef = useRef<HTMLDivElement>(null);
  const focusAfterError = useRef(false);

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

  // `verified`, `reset` and `sso` are one-shot messages, read into state
  // above; drop them so a reload or a bookmark doesn't repeat a stale notice.
  useEffect(() => {
    if (!ONE_SHOT_PARAMS.some((key) => searchParams.has(key))) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ONE_SHOT_PARAMS) next.delete(key);
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  // Fields are disabled while busy, so focus moves only once the form is live again.
  useEffect(() => {
    if (busy || !error || !focusAfterError.current) return;
    focusAfterError.current = false;
    errorRef.current?.focus();
  }, [busy, error]);

  const resendAt = sent ? sent.at + RESEND_COOLDOWN_MS : 0;
  const resendWait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (!sent || Date.now() >= resendAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sent, resendAt]);

  const setMode = (next: Mode) =>
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === "sign-in") params.delete("mode");
      else params.set("mode", next);
      return params;
    }, { replace: true });

  // The email carries over between modes; the AuthShell moves focus to the new title.
  const switchMode = (next: Mode) => {
    setError(null);
    setNotice(null);
    setSent(null);
    setMode(next);
  };

  const showSent = (kind: SentState["kind"]) => {
    const at = Date.now();
    setPassword("");
    setNow(at);
    setResent(0);
    setSent({ kind, email: email.trim(), at });
  };

  const fail = (cause: unknown, fallback: string) => {
    focusAfterError.current = true;
    setError(toAuthFailure(cause, fallback));
  };

  // Where the email verification link lands; the auth server is on another origin.
  const verifyCallbackURL = () => appUrl(`/login?verified=1&redirect=${encodeURIComponent(safeRedirect)}`);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy("email");
    setError(null);
    setNotice(null);
    try {
      if (mode !== "forgot" && !authEmailAllowed(email, allowedEmailDomains)) throw new Error(authEmailPolicyMessage(allowedEmailDomains));
      if (mode === "sign-up" && signUpUnavailable) throw new Error(SIGN_UP_UNAVAILABLE);
      const { authClient } = await loadSessionAuthClient();
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: appUrl("/reset-password") });
        if (result.error) throw authFailureFromResponse(result.error, "The reset email could not be sent.");
        showSent("reset");
        return;
      }
      // A successful sign-in returns to the app; verification messages belong only to emailed links.
      const callbackURL = mode === "sign-in" ? appUrl(safeRedirect) : verifyCallbackURL();
      const result = mode === "sign-in"
        ? await authClient.signIn.email({ email, password, callbackURL })
        : await authClient.signUp.email({ name, email, password, callbackURL });
      if (result.error?.code === "EMAIL_NOT_VERIFIED") {
        // Sign-in sends a fresh verification link when the email isn't verified.
        showSent("unverified");
        return;
      }
      if (result.error) {
        throw authFailureFromResponse(result.error, mode === "sign-in" ? "Sign-in failed. Try again." : "The account could not be created.", {
          minPasswordLength: passwordMinLength,
        });
      }
      if (mode === "sign-up" && auth.mode === "convex" && emailDelivery && !result.data?.token) {
        showSent("verify");
      }
    } catch (err: unknown) {
      fail(err, "Sign-in failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    if (busy || !sent || resendWait > 0) return;
    setBusy("resend");
    setError(null);
    try {
      const { authClient } = await loadSessionAuthClient();
      const result = sent.kind === "reset"
        ? await authClient.requestPasswordReset({ email: sent.email, redirectTo: appUrl("/reset-password") })
        : await authClient.sendVerificationEmail({ email: sent.email, callbackURL: verifyCallbackURL() });
      if (result.error) throw authFailureFromResponse(result.error, "The email could not be sent.");
      const at = Date.now();
      setNow(at);
      setSent({ ...sent, at });
      setResent((count) => count + 1);
    } catch (err: unknown) {
      const failure = toAuthFailure(err, "The email could not be sent.");
      // The error replaces the last "sent another link" line; a throttled
      // request also restarts the wait instead of inviting another try.
      setResent(0);
      if (failure.kind === "rate-limit") {
        const at = Date.now();
        setNow(at);
        setSent({ ...sent, at });
      }
      fail(failure, "The email could not be sent.");
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
      if (result.error) throw authFailureFromResponse(result.error, "Microsoft sign-in failed. Please try again.");
    } catch (err: unknown) {
      fail(err, "Microsoft sign-in failed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const errorNotice = error && (
    <div ref={errorRef} role="alert" tabIndex={-1} className="notice notice--danger auth__notice auth__error">
      <p className="auth__error-text">{error.message}</p>
      {error.kind === "account-exists" && (
        <p className="auth__error-actions">
          <button type="button" className="auth__link" onClick={() => switchMode("sign-in")}>Sign in instead</button>
          {canResetByEmail && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="auth__link" onClick={() => switchMode("forgot")}>Reset password</button>
            </>
          )}
        </p>
      )}
    </div>
  );

  if (sent) {
    return (
      <AuthShell
        {...checkEmailShell(sent)}
        after={
          <p>
            <button type="button" className="auth__link" onClick={() => switchMode("sign-in")}>Back to sign in</button>
          </p>
        }
      >
        <CheckEmailBody
          sent={sent}
          busy={busy}
          resendWait={resendWait}
          resent={resent}
          onResend={() => void resend()}
          error={errorNotice}
        />
        {import.meta.env.DEV && capabilities?.developmentMail === true && <DevMailNotice />}
      </AuthShell>
    );
  }

  const copy = MODE_COPY[mode];
  const lede = mode === "sign-up" && canResetByEmail
    ? "Use your work email. We'll send you a link to confirm it."
    : copy.lede;
  const domainHint = authEmailDomainHint(allowedEmailDomains);

  return (
    <AuthShell
      title={copy.title}
      lede={lede}
      stateKey={mode}
      after={
        <ModeSwitch
          mode={mode}
          busy={busy !== null}
          signUpPaused={capabilities?.signUpEnabled === false}
          signUpUnavailable={signUpUnavailable}
          onSwitch={switchMode}
        />
      }
      help={mode === "sign-in" && !canResetByEmail ? "Trouble signing in?" : undefined}
    >
      {invitation && <p className="notice auth__notice">You’re invited to <strong>{invitation.workspaceName}</strong>. {invitation.email ? `Use ${invitation.email}. ` : ""}Sign in or verify a new account to join directly. You don’t need to create an organization.</p>}
      {notice && <div role="status" className="notice notice--success auth__notice">{notice}</div>}
      {mode === "sign-up" && capabilities?.signUpEnabled === false && (
        <p role="status" className="notice notice--warn auth__notice">{SIGN_UP_UNAVAILABLE}</p>
      )}

      <form onSubmit={onSubmit} className="auth__form">
        <fieldset className="auth__fieldset" disabled={busy !== null}>
          {microsoftEnabled && mode !== "forgot" && (
            <>
              <button
                type="button"
                className={`btn auth__submit auth__sso${busy === "microsoft" ? " is-busy" : ""}`}
                onClick={() => void signInWithMicrosoft()}
              >
                <BusyLabel busy={busy === "microsoft"} busyText="Opening Microsoft…">
                  <MicrosoftLogo /> Continue with Microsoft
                </BusyLabel>
              </button>
              <div className="auth__divider" role="separator"><span>or</span></div>
            </>
          )}

          {mode === "sign-up" && (
            <label className="field auth-field">
              <span className="field__label">Full name</span>
              <input
                className="input auth-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                required
              />
            </label>
          )}

          <label className="field auth-field">
            <span className="field__label">Email</span>
            <input
              className="input auth-input"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete={mode === "sign-in" ? "username" : "email"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint={mode === "forgot" ? "send" : "next"}
              aria-describedby={domainHint ? "auth-email-hint" : undefined}
              required
            />
            {domainHint && <span id="auth-email-hint" className="field__hint auth-field__hint">{domainHint}</span>}
          </label>

          {mode !== "forgot" && (
            <PasswordField
              label="Password"
              labelAction={mode === "sign-in" && canResetByEmail && (
                <button type="button" className="auth__link auth__link--quiet" onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
              )}
              hint={mode === "sign-up" ? `At least ${passwordMinLength} characters.` : undefined}
              minLength={passwordMinLength}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              enterKeyHint="go"
              required
            />
          )}

          {errorNotice}

          <button
            type="submit"
            className={`btn btn--primary auth__submit${busy === "email" ? " is-busy" : ""}`}
            disabled={mode === "sign-up" && signUpUnavailable}
          >
            <BusyLabel busy={busy === "email"} busyText="Please wait…">{copy.submit}</BusyLabel>
          </button>
        </fieldset>
      </form>

      {import.meta.env.DEV && capabilities?.developmentMail === true && <DevMailNotice />}
    </AuthShell>
  );
}

const RESEND_COOLDOWN_MS = 60_000;
const ONE_SHOT_PARAMS = ["verified", "reset", "sso"] as const;

function parseMode(value: string | null): Mode {
  return value === "sign-up" || value === "forgot" ? value : "sign-in";
}

const MODE_COPY: Record<Mode, { title: string; lede: string; submit: string }> = {
  "sign-in": { title: "Sign in", lede: "Welcome back. Enter your email and password to continue.", submit: "Sign in" },
  "sign-up": { title: "Create your account", lede: "Set up your sign-in for this workspace.", submit: "Create account" },
  forgot: { title: "Reset your password", lede: "Enter your email and we'll send you a link to choose a new password.", submit: "Send reset link" },
};

function ModeSwitch({
  mode,
  busy,
  signUpPaused,
  signUpUnavailable,
  onSwitch,
}: {
  mode: Mode;
  busy: boolean;
  signUpPaused: boolean;
  signUpUnavailable: boolean;
  onSwitch: (mode: Mode) => void;
}) {
  if (mode === "sign-in" && signUpPaused) return <p>{SIGN_UP_UNAVAILABLE}</p>;
  const [prompt, action, target]: [string, string, Mode] =
    mode === "sign-in"
      ? ["New here?", "Create an account", "sign-up"]
      : mode === "sign-up"
        ? ["Already have an account?", "Sign in", "sign-in"]
        : ["Remembered it?", "Back to sign in", "sign-in"];
  return (
    <p>
      {prompt}{" "}
      <button
        type="button"
        className="auth__link"
        disabled={busy || (mode === "sign-in" && signUpUnavailable)}
        onClick={() => onSwitch(target)}
      >
        {action}
      </button>
    </p>
  );
}

function DevMailNotice() {
  return (
    <p className="auth__dev" role="note">
      <span className="auth__dev-tag">Dev</span>
      <span>
        No real email is sent. Open messages in the{" "}
        <a href="http://127.0.0.1:4599" target="_blank" rel="noopener noreferrer">local test inbox</a>.
      </span>
    </p>
  );
}

function MicrosoftLogo() {
  return (
    <svg className="auth__sso-logo" viewBox="0 0 21 21" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
