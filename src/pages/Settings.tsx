import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { SeedPrompt } from "./_helpers";
import { isDemoMode, setDemoMode } from "../lib/demoMode";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { RadioGroup, Toggle } from "../components/Controls";
import { Select } from "../components/Select";
import { SettingsShell } from "../components/ui";
import { Settings as SettingsIcon } from "lucide-react";
import { LocaleSwitcher } from "../components/LocaleSwitcher";
import { DesktopDiagnosticsPanel } from "../components/DesktopDiagnosticsPanel";
import { getAuthMode } from "../lib/authMode";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { maintenanceErrorMessage, resetDemoData, seedDemoSociety } from "../lib/maintenanceApi";
import { useThemePreference } from "../hooks/useThemePreference";
import { useOperationsDeskVisibility } from "../hooks/useOperationsDeskVisibility";
import { useAiChatVisibility } from "../hooks/useAiChatVisibility";
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
  const updateInventorySettings = useMutation(api.society.updateInventorySettings);
  const updateNotificationSettings = useMutation(api.society.updateNotificationSettings);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const setLogo = useMutation(api.society.setLogo);
  const clearLogo = useMutation(api.society.clearLogo);
  const setDarkLogo = useMutation(api.society.setDarkLogo);
  const clearDarkLogo = useMutation(api.society.clearDarkLogo);
  const setLetterhead = useMutation(api.society.setLetterhead);
  const clearLetterhead = useMutation(api.society.clearLetterhead);
  const setLogoInvertInDarkMode = useMutation(api.society.setLogoInvertInDarkMode);
  const seedSharedViews = useMutation(api.views.seedGovernanceDataTableViews);
  const confirm = useConfirm();
  const toast = useToast();
  const { preference: theme, resolvedTheme, setPreference: setTheme } = useThemePreference();
  const { hidden: operationsDeskHidden, setHidden: setOperationsDeskHidden } =
    useOperationsDeskVisibility();
  const { hidden: aiChatHidden, setHidden: setAiChatHidden } = useAiChatVisibility();
  const [moduleSettings, setModuleSettings] = useState(() => normalizeModuleSettings(undefined));
  const [savingModule, setSavingModule] = useState<ModuleKey | null>(null);
  const [inventoryPromptEnabled, setInventoryPromptEnabled] = useState(false);
  const [savingInventorySettings, setSavingInventorySettings] = useState(false);
  const [retentionDays, setRetentionDays] = useState("30");
  const [savingRetention, setSavingRetention] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState<"seed" | "reset" | null>(null);
  const [sharedViewsBusy, setSharedViewsBusy] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState<"light" | "dark" | "letterhead" | null>(null);
  const lightLogoInputRef = useRef<HTMLInputElement>(null);
  const darkLogoInputRef = useRef<HTMLInputElement>(null);
  const letterheadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!society) return;
    setModuleSettings(normalizeModuleSettings(society));
    setInventoryPromptEnabled(Boolean(society.consumableIntakeCountPromptEnabled));
    setRetentionDays(String(society.notificationRetentionDays ?? 30));
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

  const toggleConsumablePrompt = async (checked: boolean) => {
    setInventoryPromptEnabled(checked);
    setSavingInventorySettings(true);
    try {
      await updateInventorySettings({
        societyId: society._id,
        consumableIntakeCountPromptEnabled: checked,
      });
      toast.success(`Consumable count prompt ${checked ? "enabled" : "disabled"}`);
    } catch (error) {
      setInventoryPromptEnabled(Boolean(society.consumableIntakeCountPromptEnabled));
      toast.error("Couldn't update inventory settings");
    } finally {
      setSavingInventorySettings(false);
    }
  };

  const LOGO_ALLOWED_TYPES = ["image/svg+xml", "image/png", "image/jpeg"];
  const LOGO_MAX_BYTES = 2 * 1024 * 1024;

  const uploadLogoVariant = async (variant: "light" | "dark" | "letterhead", file: File) => {
    if (!society) return;
    if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
      toast.error("Unsupported file type", "Please upload an SVG, PNG, or JPG.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("File too large", "Logo must be under 2 MB.");
      return;
    }
    setUploadingLogo(variant);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = await res.json();
      if (variant === "light") {
        await setLogo({ societyId: society._id, storageId });
      } else if (variant === "dark") {
        await setDarkLogo({ societyId: society._id, storageId });
      } else {
        await setLetterhead({ societyId: society._id, storageId });
      }
      toast.success(
        variant === "light"
          ? "Logo updated"
          : variant === "dark"
            ? "Dark-mode logo updated"
            : "Letterhead updated",
      );
    } catch (error) {
      toast.error("Couldn't upload logo", error instanceof Error ? error.message : undefined);
    } finally {
      setUploadingLogo(null);
    }
  };

  const onLightLogoChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadLogoVariant("light", file);
  };

  const onDarkLogoChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadLogoVariant("dark", file);
  };

  const onLetterheadChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadLogoVariant("letterhead", file);
  };

  const removeLogoVariant = async (variant: "light" | "dark" | "letterhead") => {
    if (!society) return;
    const messages = {
      light: { title: "Remove logo?", body: "The letter avatar will be shown instead until you upload a new logo." },
      dark: { title: "Remove dark-mode logo?", body: "The light-mode logo will be used in dark mode until you upload a new variant." },
      letterhead: { title: "Remove letterhead?", body: "Exports will fall back to your light-mode logo plus the society name." },
    } as const;
    const ok = await confirm({
      title: messages[variant].title,
      message: messages[variant].body,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      if (variant === "light") {
        await clearLogo({ societyId: society._id });
      } else if (variant === "dark") {
        await clearDarkLogo({ societyId: society._id });
      } else {
        await clearLetterhead({ societyId: society._id });
      }
      toast.success(
        variant === "light"
          ? "Logo removed"
          : variant === "dark"
            ? "Dark-mode logo removed"
            : "Letterhead removed",
      );
    } catch (error) {
      toast.error("Couldn't remove logo", error instanceof Error ? error.message : undefined);
    }
  };

  const toggleLogoInvert = async (checked: boolean) => {
    if (!society) return;
    try {
      await setLogoInvertInDarkMode({ societyId: society._id, invert: checked });
    } catch (error) {
      toast.error("Couldn't update setting", error instanceof Error ? error.message : undefined);
    }
  };

  const changeRetention = async (value: string) => {
    const previous = retentionDays;
    setRetentionDays(value);
    setSavingRetention(true);
    try {
      await updateNotificationSettings({
        societyId: society._id,
        notificationRetentionDays: Number(value),
      });
      toast.success(
        value === "0"
          ? "Cleared notifications will be kept until deleted manually"
          : `Cleared notifications will be kept for ${value} days`,
      );
    } catch (error) {
      setRetentionDays(previous);
      toast.error("Couldn't update notification settings");
    } finally {
      setSavingRetention(false);
    }
  };

  return (
    <div className="page page--wide">
      <SettingsShell
        title={t("settings.title")}
        icon={<SettingsIcon size={16} />}
        iconColor="gray"
        description={t("settings.subtitle")}
        tabs={[
          { id: "workspace", label: "Workspace" },
          { id: "modules", label: "Modules" },
          { id: "runtime", label: "Runtime" },
        ]}
        activeTab="workspace"
      >

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Organization profile</h2>
          <span className="card__subtitle">
            Logo shown in the sidebar and on exported documents.
          </span>
        </div>
        <div className="card__body col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div
              className="organization-logo-preview organization-logo-preview--light"
              aria-label="Light mode preview"
            >
              {society.logoUrl ? (
                <img src={society.logoUrl} alt="" className="organization-logo-preview__img" />
              ) : (
                <span className="organization-logo-preview__placeholder">
                  {(society.name ?? "S")[0].toUpperCase()}
                </span>
              )}
            </div>
            <div className="col" style={{ gap: 6, flex: "1 1 auto", minWidth: 200 }}>
              <strong style={{ fontSize: "var(--fs-sm)" }}>Light mode</strong>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  ref={lightLogoInputRef}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={onLightLogoChosen}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={uploadingLogo === "light"}
                  onClick={() => lightLogoInputRef.current?.click()}
                >
                  {uploadingLogo === "light"
                    ? "Uploading…"
                    : society.logoUrl
                      ? "Replace logo"
                      : "Upload logo"}
                </button>
                {society.logoUrl && (
                  <button
                    type="button"
                    className="btn"
                    disabled={uploadingLogo === "light"}
                    onClick={() => { void removeLogoVariant("light"); }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                SVG, PNG, or JPG. Max 2 MB.
              </p>
            </div>
          </div>

          <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div
              className={`organization-logo-preview organization-logo-preview--dark${
                !society.logoDarkUrl && society.logoUrl && society.logoInvertInDarkMode
                  ? " organization-logo-preview--invert"
                  : ""
              }`}
              aria-label="Dark mode preview"
            >
              {society.logoDarkUrl ? (
                <img src={society.logoDarkUrl} alt="" className="organization-logo-preview__img" />
              ) : society.logoUrl ? (
                <img src={society.logoUrl} alt="" className="organization-logo-preview__img" />
              ) : (
                <span className="organization-logo-preview__placeholder organization-logo-preview__placeholder--dark">
                  {(society.name ?? "S")[0].toUpperCase()}
                </span>
              )}
            </div>
            <div className="col" style={{ gap: 6, flex: "1 1 auto", minWidth: 200 }}>
              <strong style={{ fontSize: "var(--fs-sm)" }}>Dark mode (optional)</strong>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  ref={darkLogoInputRef}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={onDarkLogoChosen}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={uploadingLogo === "dark"}
                  onClick={() => darkLogoInputRef.current?.click()}
                >
                  {uploadingLogo === "dark"
                    ? "Uploading…"
                    : society.logoDarkUrl
                      ? "Replace logo"
                      : "Upload logo"}
                </button>
                {society.logoDarkUrl && (
                  <button
                    type="button"
                    className="btn"
                    disabled={uploadingLogo === "dark"}
                    onClick={() => { void removeLogoVariant("dark"); }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Used in dark mode if provided. Falls back to the light-mode logo otherwise.
              </p>
            </div>
          </div>

          {society.logoUrl && !society.logoDarkUrl && (
            <Toggle
              checked={Boolean(society.logoInvertInDarkMode)}
              onChange={(checked) => { void toggleLogoInvert(checked); }}
              label="Invert light-mode logo for dark mode"
              hint="Works best for monochrome (black-line) logos. Skip if your logo has color."
            />
          )}

          <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div
              className="organization-logo-preview organization-logo-preview--letterhead organization-logo-preview--light"
              aria-label="Letterhead preview"
            >
              {society.letterheadUrl ? (
                <img src={society.letterheadUrl} alt="" className="organization-logo-preview__img" />
              ) : (
                <span className="organization-logo-preview__placeholder">
                  {(society.name ?? "S").toUpperCase()}
                </span>
              )}
            </div>
            <div className="col" style={{ gap: 6, flex: "1 1 auto", minWidth: 200 }}>
              <strong style={{ fontSize: "var(--fs-sm)" }}>Document letterhead (optional)</strong>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  ref={letterheadInputRef}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={onLetterheadChosen}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={uploadingLogo === "letterhead"}
                  onClick={() => letterheadInputRef.current?.click()}
                >
                  {uploadingLogo === "letterhead"
                    ? "Uploading…"
                    : society.letterheadUrl
                      ? "Replace letterhead"
                      : "Upload letterhead"}
                </button>
                {society.letterheadUrl && (
                  <button
                    type="button"
                    className="btn"
                    disabled={uploadingLogo === "letterhead"}
                    onClick={() => { void removeLogoVariant("letterhead"); }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Shown as the header on exported minutes, meeting packs, and the public copy. Leave empty for unbranded exports — the sidebar logo is not used here.
              </p>
            </div>
          </div>
        </div>
      </div>

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

      <DesktopDiagnosticsPanel />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Sidebar</h2>
          <span className="card__subtitle">Choose which sidebar sections show in your workspace.</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <Toggle
            checked={!operationsDeskHidden}
            onChange={(checked) => setOperationsDeskHidden(!checked)}
            label={t("sidebar.showOperationsDesk")}
            hint={t("sidebar.showOperationsDeskHint")}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">AI assistant</h2>
          <span className="card__subtitle">Show or hide the in-app AI chat features.</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <Toggle
            checked={!aiChatHidden}
            onChange={(checked) => setAiChatHidden(!checked)}
            label="Enable AI chat"
            hint="When off, the sidebar bot button and the floating AI assistant are removed. Other AI-driven helpers (e.g. transcript generation) stay available."
          />
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
        <div className="card__head">
          <h2 className="card__title">Inventory</h2>
          <span className="card__subtitle">Controls for asset and consumable workflows.</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <Toggle
            checked={inventoryPromptEnabled}
            onChange={toggleConsumablePrompt}
            disabled={savingInventorySettings}
            label="Prompt for current count when adding consumables"
            hint="When adding stock to a consumable item, ask how many are left first, then add the new amount to that observed count."
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Notifications</h2>
          <span className="card__subtitle">Controls for the in-app notification center.</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <div className="settings-row" style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>Keep cleared notifications for</div>
              <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                When you clear a notification it leaves the bell immediately, but stays on the
                Notifications page under “Dismissed” for this long before it’s permanently deleted.
              </div>
            </div>
            <div style={{ flexShrink: 0, minWidth: 160 }}>
              <Select
                value={retentionDays}
                onChange={changeRetention}
                disabled={savingRetention}
                options={[
                  { value: "7", label: "7 days" },
                  { value: "14", label: "14 days" },
                  { value: "30", label: "30 days" },
                  { value: "60", label: "60 days" },
                  { value: "90", label: "90 days" },
                  { value: "0", label: "Keep until deleted" },
                ]}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Workspace shared views</h2></div>
        <div className="card__body col">
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Seed shared governance views for board work, filings, attestations, conflicts, and grants.
          </div>
          <div className="row">
            <button
              className="btn btn--accent"
              disabled={sharedViewsBusy}
              onClick={async () => {
                setSharedViewsBusy(true);
                try {
                  const result = await seedSharedViews({ societyId: society._id });
                  toast.success("Shared views seeded", `${result.created.length} created, ${result.skipped.length} skipped`);
                } catch (error: any) {
                  toast.error("Could not seed shared views", error?.message);
                } finally {
                  setSharedViewsBusy(false);
                }
              }}
            >
              {sharedViewsBusy ? "Seeding..." : "Seed governance shared views"}
            </button>
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
      </SettingsShell>
    </div>
  );
}
