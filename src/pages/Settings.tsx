import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { PageHeader, SeedPrompt } from "./_helpers";
import { isDemoMode, setDemoMode } from "../lib/demoMode";
import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { RadioGroup, Toggle } from "../components/Controls";
import { LocaleSwitcher } from "../components/LocaleSwitcher";
import { getAuthMode } from "../lib/authMode";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { maintenanceErrorMessage, resetDemoData, seedDemoSociety } from "../lib/maintenanceApi";
import { useThemePreference } from "../hooks/useThemePreference";
import { useTranslation } from "react-i18next";
import type { ThemePreference } from "../lib/theme";
import {
  MODULE_CATEGORIES,
  MODULE_DEFINITIONS,
  MODULES_BY_KEY,
  normalizeModuleSettings,
  settingsToDisabledModules,
  type ModuleKey,
} from "../lib/modules";

export function SettingsPage() {
  const { t } = useTranslation();
  const society = useSociety();
  const [demo, setDemo] = useState(isDemoMode());
  const authMode = getAuthMode();
  const updateModules = useMutation(api.society.updateModules);
  const confirm = useConfirm();
  const toast = useToast();
  const { preference: theme, resolvedTheme, setPreference: setTheme } = useThemePreference();
  const [moduleSettings, setModuleSettings] = useState(() => normalizeModuleSettings(undefined));
  const [savingModule, setSavingModule] = useState<ModuleKey | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState<"seed" | "reset" | null>(null);

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

  const themeOptions = useMemo(
    () => [
      {
        value: "system" as const,
        label: t("settings.systemTheme"),
        hint: t("settings.systemThemeHint", {
          theme: t(`settings.${resolvedTheme}Theme`).toLowerCase(),
        }),
      },
      {
        value: "light" as const,
        label: t("settings.lightTheme"),
        hint: t("settings.lightThemeHint"),
      },
      {
        value: "dark" as const,
        label: t("settings.darkTheme"),
        hint: t("settings.darkThemeHint"),
      },
    ],
    [resolvedTheme, t],
  );

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
    <div className="page page--wide">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <div className="settings-pair" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">{t("settings.languageTitle")}</h2>
            <span className="card__subtitle">{t("settings.languageSubtitle")}</span>
          </div>
          <div className="card__body row" style={{ gap: 8 }}>
            <LocaleSwitcher />
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2 className="card__title">{t("settings.appearanceTitle")}</h2></div>
          <div className="card__body row" style={{ gap: 8 }}>
            <RadioGroup<ThemePreference>
              name="appearance-theme"
              value={theme}
              onChange={setTheme}
              options={themeOptions}
              direction="horizontal"
            />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">{t("settings.modulesTitle")}</h2>
          <span className="card__subtitle">{t("settings.modulesSubtitle")}</span>
        </div>
        <div className="card__body col" style={{ gap: 16 }}>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            {t("settings.modulesHint")}
          </div>

          <div className="settings-modules">
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
            <button
              className="btn btn--accent"
              disabled={maintenanceBusy !== null}
              onClick={async () => {
                setMaintenanceBusy("seed");
                try {
                  const result = await seedDemoSociety();
                  setStoredSocietyId(result.societyId);
                  toast.success("Demo society seeded");
                } catch (error) {
                  toast.error(maintenanceErrorMessage(error));
                } finally {
                  setMaintenanceBusy(null);
                }
              }}
            >
              {maintenanceBusy === "seed" ? "Seeding..." : "Seed / reseed demo society"}
            </button>
            <button
              className="btn btn--danger"
              disabled={maintenanceBusy !== null}
              onClick={async () => {
                const ok = await confirm({
                  title: "Wipe all data?",
                  message: "Every table will be dropped. This cannot be undone.",
                  confirmLabel: "Wipe everything",
                  tone: "danger",
                });
                if (!ok) return;
                setMaintenanceBusy("reset");
                try {
                  await resetDemoData();
                  setStoredSocietyId(null);
                  toast.success("All data wiped");
                } catch (error) {
                  toast.error(maintenanceErrorMessage(error));
                } finally {
                  setMaintenanceBusy(null);
                }
              }}
            >
              {maintenanceBusy === "reset" ? "Wiping..." : "Wipe all data"}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-pair">
        <div className="card">
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
    </div>
  );
}
