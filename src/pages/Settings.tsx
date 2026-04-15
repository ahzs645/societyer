import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PageHeader, SeedPrompt } from "./_helpers";
import { isDemoMode, setDemoMode } from "../lib/demoMode";
import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Toggle } from "../components/Controls";
import { getAuthMode } from "../lib/authMode";
import { useSociety } from "../hooks/useSociety";
import {
  MODULE_CATEGORIES,
  MODULE_DEFINITIONS,
  MODULES_BY_KEY,
  normalizeModuleSettings,
  settingsToDisabledModules,
  type ModuleKey,
} from "../lib/modules";

export function SettingsPage() {
  const society = useSociety();
  const [demo, setDemo] = useState(isDemoMode());
  const authMode = getAuthMode();
  const seed = useMutation(api.seed.run);
  const reset = useMutation(api.seed.reset);
  const updateModules = useMutation(api.society.updateModules);
  const confirm = useConfirm();
  const toast = useToast();
  const [theme, setTheme] = useState<string>(document.documentElement.classList.contains("dark") ? "dark" : "light");
  const [moduleSettings, setModuleSettings] = useState(() => normalizeModuleSettings(undefined));
  const [savingModule, setSavingModule] = useState<ModuleKey | null>(null);

  useEffect(() => {
    if (!society) return;
    setModuleSettings(normalizeModuleSettings(society));
  }, [society]);

  const modulesByCategory = useMemo(
    () =>
      MODULE_CATEGORIES.map((category) => ({
        category,
        items: MODULE_DEFINITIONS.filter((module) => module.category === category),
      })),
    [],
  );

  const applyTheme = (t: string) => {
    setTheme(t);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
  };

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const toggleModule = async (key: ModuleKey, checked: boolean) => {
    const next = { ...moduleSettings, [key]: checked };
    setModuleSettings(next);
    setSavingModule(key);
    try {
      await updateModules({
        societyId: society._id,
        disabledModules: settingsToDisabledModules(next),
      });
      toast.success(`${MODULES_BY_KEY[key].label} ${checked ? "enabled" : "disabled"}`);
    } catch (error) {
      setModuleSettings(normalizeModuleSettings(society));
      toast.error(`Couldn't update ${MODULES_BY_KEY[key].label.toLowerCase()}`);
    } finally {
      setSavingModule(null);
    }
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
        <div className="card__head">
          <h2 className="card__title">Modules</h2>
          <span className="card__subtitle">Enable only the parts this organization actually uses.</span>
        </div>
        <div className="card__body col" style={{ gap: 16 }}>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Disabling a module hides its navigation, command-palette entries, public entry points,
            and guarded routes. Existing data stays in place and becomes available again if you
            re-enable the module later.
          </div>

          {modulesByCategory.map(({ category, items }) => (
            <div key={category} className="card" style={{ background: "var(--bg-base)" }}>
              <div className="card__head">
                <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>{category}</h3>
              </div>
              <div className="card__body col" style={{ gap: 12 }}>
                {items.map((module) => (
                  <div
                    key={module.key}
                    style={{
                      paddingBottom: 12,
                      borderBottom:
                        module.key === items[items.length - 1]?.key
                          ? "none"
                          : "1px solid var(--border)",
                    }}
                  >
                    <Toggle
                      checked={moduleSettings[module.key]}
                      onChange={(checked) => toggleModule(module.key, checked)}
                      disabled={savingModule === module.key}
                      label={module.label}
                      hint={module.description}
                    />
                    <div className="muted" style={{ fontSize: "var(--fs-sm)", paddingLeft: 42, marginTop: 4 }}>
                      Includes: {module.includes.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Authentication</h2></div>
        <div className="card__body col">
          <div className="muted">
            Auth mode: <code className="mono">{authMode}</code>
          </div>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Set <code className="mono">VITE_AUTH_MODE</code> and <code className="mono">AUTH_MODE</code> to <code className="mono">better-auth</code> for real login,
            or leave them as <code className="mono">none</code> to keep the local no-auth workflow.
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
