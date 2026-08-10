import { useEffect, useState } from "react";
import { Building2, Check, CloudCog, HardDrive, Loader2, Upload } from "lucide-react";
import {
  clearAppRuntimeChoice,
  newLocalWorkspaceId,
  normalizeServerUrl,
  probeServerUrl,
  readAppRuntimeChoice,
  writeAppRuntimeChoice,
} from "../lib/appRuntime";
import { InstallAppPrompt } from "../components/InstallAppPrompt";

type ProbeState = { status: "idle" } | { status: "checking" } | { status: "done"; ok: boolean; message: string };

const SETUP_STEPS = [
  "Choose where records live",
  "Create or restore an organization",
  "Work through onboarding tasks",
];

/**
 * FIRST-RUN SETUP, rendered outside the data providers on purpose.
 *
 * The answer collected here decides which client the app builds at import time
 * (browser-local Dexie vs a Convex connection), so the choice is persisted and
 * the app is reloaded rather than swapped in place.
 */
export function AppSetupPage() {
  const [existing] = useState(() => readAppRuntimeChoice());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Set up Societyer";
  }, []);

  const goTo = (path: string) => {
    // Full document load, not a client-side navigation: the data client is
    // constructed once at module import from the choice we just wrote.
    setBusy(true);
    window.location.assign(path);
  };

  const chooseLocal = (intent: "fresh" | "restore") => {
    setError(null);
    try {
      const existingLocal = existing?.mode === "local" ? existing.workspaceId : null;
      writeAppRuntimeChoice({
        mode: "local",
        workspaceId: existingLocal ?? newLocalWorkspaceId(),
        chosenAtISO: new Date().toISOString(),
      });
    } catch {
      setError(
        "This browser blocked local storage, so Societyer cannot keep records on this device. Allow site data, or connect to a server instead.",
      );
      return;
    }
    goTo(intent === "restore" ? "/app/society/new?restore=1" : "/app/society/new");
  };

  const chooseServer = (url: string) => {
    setError(null);
    writeAppRuntimeChoice({ mode: "server", url, chosenAtISO: new Date().toISOString() });
    goTo("/app");
  };

  return (
    <div className="society-create-shell">
      <div className="app-setup">
        <header className="app-setup__intro">
          <div className="society-create__brand">
            <div className="society-create__logo"><Building2 size={18} /></div>
            <span>Societyer setup</span>
          </div>
          <div className="society-create__copy">
            <h1>Where should your records live?</h1>
            <p>
              Societyer keeps a society's governance records, documents, and filings in one workspace.
              Pick where this device stores them. You can change it later, and export a backup at any time.
            </p>
          </div>
          <ol className="app-setup__steps" aria-label="Setup steps">
            {SETUP_STEPS.map((step, index) => (
              <li className="society-create__step" key={step}>
                <span className="society-create__step-index">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <InstallAppPrompt />
        </header>

        <main className="app-setup__options">
          {error && <div className="notice notice--danger">{error}</div>}

          {existing && (
            <div className="notice notice--info app-setup__current">
              <span>
                This device is already set up to use{" "}
                <strong>{existing.mode === "local" ? "local storage on this device" : existing.url}</strong>.
              </span>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--sm" type="button" onClick={() => goTo("/app")} disabled={busy}>
                  Open workspace
                </button>
                <button
                  className="btn btn--sm"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    clearAppRuntimeChoice();
                    window.location.reload();
                  }}
                >
                  Forget this choice
                </button>
              </div>
            </div>
          )}

          <LocalStorageOption busy={busy} onChoose={chooseLocal} />
          <ServerOption
            busy={busy}
            initialUrl={existing?.mode === "server" ? existing.url : ""}
            onConnect={chooseServer}
            onInvalidUrl={setError}
          />

          <p className="muted app-setup__footnote">
            Just looking around? <a href="/demo">Open the seeded demo</a> — it runs on sample data and never
            touches your workspace.
          </p>
        </main>
      </div>
    </div>
  );
}

function LocalStorageOption({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose: (intent: "fresh" | "restore") => void;
}) {
  return (
    <section className="card app-setup__card">
      <div className="card__head">
        <div className="app-setup__card-head">
          <HardDrive size={16} />
          <div>
            <h2 className="card__title">Keep records on this device</h2>
            <span className="card__subtitle">Recommended for a single society with one or two officers.</span>
          </div>
        </div>
      </div>
      <div className="card__body">
        <ul className="app-setup__points">
          <li>Everything is stored in this browser and works offline once installed.</li>
          <li>No account, no server, and nothing leaves the device unless you export it.</li>
          <li>Clearing this browser's site data erases the workspace — export backups regularly.</li>
        </ul>
        <div className="app-setup__actions">
          <button className="btn btn--accent" type="button" onClick={() => onChoose("fresh")} disabled={busy}>
            <Check size={14} /> Start a new organization
          </button>
          <button className="btn" type="button" onClick={() => onChoose("restore")} disabled={busy}>
            <Upload size={14} /> I have a backup to restore
          </button>
        </div>
      </div>
    </section>
  );
}

function ServerOption({
  busy,
  initialUrl,
  onConnect,
  onInvalidUrl,
}: {
  busy: boolean;
  initialUrl: string;
  onConnect: (url: string) => void;
  onInvalidUrl: (message: string) => void;
}) {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });

  const normalize = () => {
    try {
      return normalizeServerUrl(serverUrl);
    } catch (caught) {
      onInvalidUrl(caught instanceof Error ? caught.message : "That address could not be read.");
      return null;
    }
  };

  const test = async () => {
    const normalized = normalize();
    if (!normalized) return;
    setServerUrl(normalized);
    setProbe({ status: "checking" });
    const result = await probeServerUrl(normalized);
    setProbe({ status: "done", ok: result.ok, message: result.message });
  };

  return (
    <section className="card app-setup__card">
      <div className="card__head">
        <div className="app-setup__card-head">
          <CloudCog size={16} />
          <div>
            <h2 className="card__title">Connect to a Societyer server</h2>
            <span className="card__subtitle">For shared workspaces where several people need the same records.</span>
          </div>
        </div>
      </div>
      <div className="card__body">
        <ul className="app-setup__points">
          <li>Records live on the backend you self-host; this device is just a client.</li>
          <li>Enter the Convex backend address, for example <code className="mono">https://societyer.example.org</code>.</li>
        </ul>
        <label className="field__label" htmlFor="app-setup-server">Server address</label>
        <div className="app-setup__server-row">
          <input
            id="app-setup-server"
            className="input"
            inputMode="url"
            autoComplete="url"
            placeholder="https://societyer.example.org"
            value={serverUrl}
            onChange={(event) => {
              setServerUrl(event.target.value);
              setProbe({ status: "idle" });
            }}
          />
          <button
            className="btn"
            type="button"
            onClick={() => void test()}
            disabled={busy || !serverUrl.trim() || probe.status === "checking"}
          >
            {probe.status === "checking" ? <Loader2 size={14} className="spin" /> : null}
            {probe.status === "checking" ? "Checking…" : "Test"}
          </button>
        </div>
        {probe.status === "done" && (
          <div className={probe.ok ? "notice notice--success" : "notice notice--warning"}>
            {probe.ok
              ? probe.message
              : `${probe.message} You can still connect — some servers block this check while the app itself works.`}
          </div>
        )}
        <div className="app-setup__actions">
          <button
            className="btn btn--accent"
            type="button"
            disabled={busy || !serverUrl.trim()}
            onClick={() => {
              const normalized = normalize();
              if (normalized) onConnect(normalized);
            }}
          >
            Connect
          </button>
        </div>
      </div>
    </section>
  );
}
