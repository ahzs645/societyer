import { useEffect, useRef, useState, type FormEvent } from "react";
import { loadSessionAuthClient } from "../lib/sessionAuthClient";
import { AuthPending, AuthShell, BusyLabel } from "./AuthShell";
import { authFailureFromResponse, toAuthFailure } from "./authErrors";

export default function SecondFactorPrompt({ onCancel }: { onCancel: () => void }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => { codeInput.current?.focus(); }, [backup]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || verified) return;
    setBusy(true);
    setError("");
    try {
      const { authClient } = await loadSessionAuthClient();
      const result = backup
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
        : await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (result.error?.code === "INVALID_TWO_FACTOR_COOKIE") {
        setError("This sign-in attempt has expired. Return to sign in and try again.");
        return;
      }
      if (result.error) throw authFailureFromResponse(result.error, "Could not verify the code.");
      setCode("");
      setVerified(true);
    } catch (cause) {
      setError(toAuthFailure(cause, "Could not verify the code.").message);
    } finally {
      setBusy(false);
    }
  }

  return <AuthShell
    title="Verify your sign-in"
    lede={backup ? "Enter one of the backup codes you saved during setup." : "Enter the six-digit code from your authenticator app."}
    after={<button type="button" className="auth__link" disabled={busy || verified} onClick={onCancel}>Back to sign in</button>}
    stateKey="second-factor"
  >
    {verified ? <AuthPending>Checking your workspace access…</AuthPending> : (
      <form className="auth__form" onSubmit={verify}>
        <fieldset className="auth__fieldset" disabled={busy}>
          <label className="field auth-field">
            <span className="field__label">{backup ? "Backup code" : "Authenticator code"}</span>
            <input
              ref={codeInput}
              className="input auth-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              pattern={backup ? undefined : "[0-9]{6}"}
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
          <button type="submit" className="btn btn--primary auth__submit">
            <BusyLabel busy={busy} busyText="Verifying…">Verify and sign in</BusyLabel>
          </button>
          <button type="button" className="auth__link" onClick={() => {
            setBackup(!backup);
            setCode("");
            setError("");
          }}>{backup ? "Use an authenticator code" : "Use a backup code"}</button>
        </fieldset>
      </form>
    )}
  </AuthShell>;
}
