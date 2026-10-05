import { useEffect, useState } from "react";
import { Cloud, HardDrive } from "lucide-react";
import { getDesktopBridge, type DesktopModeState } from "../lib/desktopBridge";

export function DesktopModePanel() {
  const [state, setState] = useState<DesktopModeState | null>(null);
  const [origin, setOrigin] = useState("");
  const [authenticationOrigins, setAuthenticationOrigins] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.getDesktopMode) return;
    let active = true;
    const refresh = (initialize = false) => void bridge.getDesktopMode().then((next) => {
      if (!active) return;
      setState(next);
      if (initialize) {
        setOrigin(next.hostedApplication?.origin ?? "");
        setAuthenticationOrigins(next.hostedApplication?.authenticationOrigins.join("\n") ?? "");
      }
    }).catch(() => { if (active) setError("Desktop mode settings could not be loaded."); });
    refresh(true);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, []);

  const switchMode = async (mode: "local" | "online") => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      setState(mode === "local" ? await bridge.returnToLocalMode() : await bridge.openHostedMode({
        origin: origin.trim(),
        authenticationOrigins: authenticationOrigins.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch desktop mode.");
    } finally { setBusy(false); }
  };

  return (
    <section className="card" aria-label="Desktop workspace modes" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <div>
          <h2 className="card__title">Local and online workspaces</h2>
          <span className="card__subtitle">Choose how you want to work in this desktop app.</span>
        </div>
      </div>
      <div className="card__body col" style={{ gap: 16 }}>
        <div className="settings-pair">
          <div className="col" style={{ gap: 8 }}>
            <strong><HardDrive size={16} /> Offline-only local workspace</strong>
            <p className="muted" style={{ margin: 0 }}>
              Records and files stay on this computer. Core work needs no server or hosted sign-in.
              Your local workspace remains available when the online app cannot connect.
            </p>
            <button className="btn" disabled={busy} onClick={() => void switchMode("local")}>Use local workspace</button>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <strong><Cloud size={16} /> Online workspace</strong>
            <p className="muted" style={{ margin: 0 }}>
              Sign in to your hosted Societyer web app and use its workspace roles and services.
              Offline meeting preparation is available when enabled by your administrator.
            </p>
            <label className="col" style={{ gap: 4 }}>
              <span>Societyer app HTTPS address</span>
              <input className="input" type="url" placeholder="https://your-societyer.example" value={origin}
                onChange={(event) => setOrigin(event.target.value)} disabled={busy} autoComplete="url" />
            </label>
            <details>
              <summary>External sign-in providers</summary>
              <label className="col" style={{ gap: 4, marginTop: 8 }}>
                <span>Exact HTTPS sign-in origins, one per line (optional)</span>
                <textarea className="input" rows={3} value={authenticationOrigins} disabled={busy}
                  placeholder="https://login.microsoftonline.com"
                  onChange={(event) => setAuthenticationOrigins(event.target.value)} />
                <span className="muted">Only add origins supplied by your app administrator. Wildcards and HTTP are blocked.</span>
              </label>
            </details>
            <button className="btn btn--accent" disabled={busy || !origin.trim()} onClick={() => void switchMode("online")}>
              {busy ? "Opening workspace…" : "Open online workspace"}
            </button>
          </div>
        </div>
        <div className="notice notice--info">
          Local and hosted records are separate. Switching modes keeps your local vault and hosted sign-in session;
          it does not upload or merge your local records. Save online forms before switching: returning locally closes
          the online window and its connections. Use File → Return to Local Workspace to switch back from the online app.
        </div>
        {state?.startupMode === "online" && <p className="muted" style={{ margin: 0 }}>This app will try the online workspace at startup and open locally if it cannot connect.</p>}
        {(error || state?.lastError) && <div role="alert" className="notice notice--warning">{error || state?.lastError}</div>}
      </div>
    </section>
  );
}
