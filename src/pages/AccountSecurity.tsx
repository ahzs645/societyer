import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import QRCode from "qrcode";
import { AuthPending, AuthShell, BusyLabel } from "../auth/AuthShell";
import { useAuth } from "../auth/AuthProvider";
import { useAuthenticatorEnrollment } from "../auth/authCapabilities";
import { authFailureFromResponse, toAuthFailure } from "../auth/authErrors";
import { PasswordField } from "../auth/PasswordField";
import { usesBetterAuthClient } from "../lib/authMode";
import { loadSessionAuthClient } from "../lib/sessionAuthClient";

type Operation = "enroll" | "regenerate" | "disable";
const labels: Record<Operation, string> = {
  enroll: "Set up authenticator",
  regenerate: "Generate new backup codes",
  disable: "Turn off two-factor authentication",
};

export default function AccountSecurityPage() {
  const auth = useAuth();
  const enrollmentEnabled = useAuthenticatorEnrollment();
  if (!usesBetterAuthClient(auth.mode)) return <Navigate to="/app" replace />;
  if (auth.sessionStatus === "loading") {
    return <AuthShell title="Account security"><AuthPending>Checking your session…</AuthPending></AuthShell>;
  }
  if (!auth.session) return <Navigate to="/login?redirect=%2Faccount%2Fsecurity" replace />;
  return <AuthenticatorSettings
    key={auth.session.user.id}
    enabled={auth.session.user.twoFactorEnabled === true}
    enrollmentEnabled={enrollmentEnabled}
    accountPages={auth.mode === "convex"}
  />;
}

function AuthenticatorSettings({ enabled, enrollmentEnabled, accountPages }: { enabled: boolean; enrollmentEnabled: boolean; accountPages: boolean }) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    if (enabled || !enrollmentEnabled) return;
    let active = true;
    void loadSessionAuthClient().then(async ({ authClient }) => {
      const result = await authClient.listAccounts();
      if (active && result.data) setHasPassword(result.data.some(account => account.providerId === "credential"));
    }).catch(() => {
      // The server checks the password again at enrollment.
    });
    return () => { active = false; };
  }, [enabled, enrollmentEnabled]);

  function chooseOperation(next: Operation | null) {
    setOperation(next);
    setPassword("");
    setError("");
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !operation) return;
    setBusy(true);
    setError("");
    try {
      const { authClient } = await loadSessionAuthClient();
      if (operation === "enroll") {
        const result = await authClient.twoFactor.enable({ password, method: "totp" });
        if (result.error) throw authFailureFromResponse(result.error, "Could not set up the authenticator.");
        if (result.data?.method !== "totp") throw new Error("Authenticator setup is unavailable.");
        setSetup({ uri: result.data.totpURI, backupCodes: result.data.backupCodes });
      } else if (operation === "regenerate") {
        const result = await authClient.twoFactor.generateBackupCodes({ password });
        if (result.error) throw authFailureFromResponse(result.error, "Could not generate backup codes.");
        setBackupCodes(result.data.backupCodes);
      } else {
        const result = await authClient.twoFactor.disable({ password });
        if (result.error) throw authFailureFromResponse(result.error, "Could not turn off two-factor authentication.");
      }
      chooseOperation(null);
    } catch (cause) {
      setError(toAuthFailure(cause, "Could not update account security.").message);
    } finally {
      setBusy(false);
    }
  }

  async function verifySetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || busy) return;
    setBusy(true);
    setError("");
    try {
      const { authClient } = await loadSessionAuthClient();
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) throw authFailureFromResponse(result.error, "Could not verify the authenticator code.");
      setBackupCodes(setup.backupCodes);
      setSetup(null);
      setCode("");
    } catch (cause) {
      setError(toAuthFailure(cause, "Could not verify the authenticator code.").message);
    } finally {
      setBusy(false);
    }
  }

  const notice = error && <p className="notice notice--danger auth__notice" role="alert">{error}</p>;
  return <AuthShell
    title={backupCodes ? "Save your backup codes" : setup ? "Connect your authenticator" : "Account security"}
    stateKey={backupCodes ? "backup-codes" : setup ? "authenticator-setup" : "security"}
    after={<nav className="account-links" aria-label="Account">
      <Link to="/app" className="auth__link">Back to workspace</Link>
      {accountPages && <>
        <Link to="/account/workspaces" className="auth__link">My workspaces</Link>
        <Link to="/account/sign-in-methods" className="auth__link">Sign-in methods</Link>
      </>}
    </nav>}
  >
    {backupCodes ? (
      <div className="auth__form">
        <p>Store these codes somewhere safe. Each code can be used once if you lose access to your authenticator.</p>
        <ul aria-label="Backup codes">
          {backupCodes.map(value => <li key={value}><code>{value}</code></li>)}
        </ul>
        <button type="button" className="btn btn--primary auth__submit" onClick={() => setBackupCodes(null)}>Done</button>
      </div>
    ) : setup ? (
      <form className="auth__form" onSubmit={verifySetup}>
        <fieldset className="auth__fieldset" disabled={busy}>
          <AuthenticatorCode uri={setup.uri} />
          <label className="field auth-field">
            <span className="field__label">Authenticator code</span>
            <input className="input auth-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value)} required />
          </label>
          {notice}
          <button type="submit" className="btn btn--primary auth__submit">
            <BusyLabel busy={busy} busyText="Verifying…">Verify and enable</BusyLabel>
          </button>
          <button type="button" className="auth__link" onClick={() => {
            setSetup(null);
            setCode("");
            setError("");
          }}>Cancel setup</button>
        </fieldset>
      </form>
    ) : operation ? (
      <form className="auth__form" onSubmit={submitPassword}>
        <fieldset className="auth__fieldset" disabled={busy}>
          {operation === "regenerate" && <p>Your existing backup codes will expire.</p>}
          <PasswordField label="Current password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required />
          {notice}
          <button type="submit" className="btn btn--primary auth__submit">
            <BusyLabel busy={busy} busyText="Saving…">{labels[operation]}</BusyLabel>
          </button>
          <button type="button" className="auth__link" onClick={() => chooseOperation(null)}>Cancel</button>
        </fieldset>
      </form>
    ) : (
      <div className="auth__form">
        <p role="status">{enabled ? "Two-factor authentication is on." : "Two-factor authentication is off."}</p>
        {enabled ? <>
          <button type="button" className="btn" onClick={() => chooseOperation("regenerate")}>{labels.regenerate}</button>
          <button type="button" className="btn" onClick={() => chooseOperation("disable")}>{labels.disable}</button>
        </> : enrollmentEnabled && hasPassword !== false ? (
          <button type="button" className="btn btn--primary auth__submit" onClick={() => chooseOperation("enroll")}>{labels.enroll}</button>
        ) : <p>{enrollmentEnabled ? "Manage two-factor authentication with the provider you use to sign in." : "Authenticator enrollment is closed for this instance."}</p>}
      </div>
    )}
  </AuthShell>;
}

function AuthenticatorCode({ uri }: { uri: string }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(uri, { width: 192 }).then(url => {
      if (active) setImage(url);
    }).catch(() => {
      // The manual key remains available if the QR code cannot be drawn.
    });
    return () => { active = false; };
  }, [uri]);

  return <div>
    <p>Scan this QR code with your authenticator app or enter the setup key manually.</p>
    {image && <img src={image} alt="Authenticator setup QR code" width={192} height={192} />}
    <p>Setup key <code aria-label="Authenticator setup key" style={{ overflowWrap: "anywhere" }}>{new URL(uri).searchParams.get("secret")}</code></p>
  </div>;
}
