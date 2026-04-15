import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "./_helpers";
import { isDemoMode, setDemoMode } from "../lib/demoMode";
import { useState } from "react";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Toggle } from "../components/Controls";

export function SettingsPage() {
  const [demo, setDemo] = useState(isDemoMode());
  const seed = useMutation(api.seed.run);
  const reset = useMutation(api.seed.reset);
  const confirm = useConfirm();
  const toast = useToast();
  const [theme, setTheme] = useState<string>(document.documentElement.classList.contains("dark") ? "dark" : "light");

  const applyTheme = (t: string) => {
    setTheme(t);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
  };

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Workspace-level preferences and demo data controls." />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Appearance</h2></div>
        <div className="card__body row" style={{ gap: 8 }}>
          <button className={`btn${theme === "light" ? " btn--accent" : ""}`} onClick={() => applyTheme("light")}>Light</button>
          <button className={`btn${theme === "dark" ? " btn--accent" : ""}`} onClick={() => applyTheme("dark")}>Dark</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Demo mode</h2></div>
        <div className="card__body col">
          <Toggle
            checked={demo}
            onChange={(v) => {
              setDemoMode(v);
              setDemo(v);
            }}
            label="Show demo banner and allow seeding a fake society"
          />
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Append <code className="mono">?demo=1</code> to any URL to force-enable, <code className="mono">?demo=0</code> to disable.
          </div>
          <div className="row">
            <button className="btn btn--accent" onClick={() => seed({})}>Seed / reseed demo society</button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                const ok = await confirm({
                  title: "Wipe all data?",
                  message: "Every table will be dropped. This cannot be undone.",
                  confirmLabel: "Wipe everything",
                  tone: "danger",
                });
                if (!ok) return;
                await reset({});
                toast.success("All data wiped");
              }}
            >
              Wipe all data
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">Convex deployment</h2></div>
        <div className="card__body col">
          <div className="muted">VITE_CONVEX_URL: <code className="mono">{import.meta.env.VITE_CONVEX_URL ?? "— (not set)"}</code></div>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Run <code className="mono">npx convex dev</code> for cloud, or point to a self-hosted backend from{" "}
            <a href="https://github.com/get-convex/convex-backend" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              get-convex/convex-backend
            </a>
            . See <code className="mono">README.md</code>.
          </div>
        </div>
      </div>
    </div>
  );
}
