import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { PageLoading, SeedPrompt } from "./_helpers";
import { isDemoMode, setDemoMode } from "../lib/demoMode";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { RadioGroup, Toggle } from "../components/Controls";
import { Select } from "../components/Select";
import { Badge, SettingsShell } from "../components/ui";
import { Settings as SettingsIcon, AlertTriangle } from "lucide-react";
import { LocaleSwitcher } from "../components/LocaleSwitcher";
import { DesktopDiagnosticsPanel } from "../components/DesktopDiagnosticsPanel";
import { WorkspaceStorageCard } from "../components/WorkspaceStorageCard";
import { DocumentStorageSettingsCard } from "../components/DocumentStorageSettingsCard";
import { IdentitySessionSettingsCard } from "../components/IdentitySessionSettingsCard";
import { resolveAppRuntime } from "../lib/appRuntime";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { readFileDataUrl } from "../lib/readFileDataUrl";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { maintenanceErrorMessage, resetDemoData, seedDemoSociety } from "../lib/maintenanceApi";
import { useThemePreference } from "../hooks/useThemePreference";
import { useOperationsDeskVisibility } from "../hooks/useOperationsDeskVisibility";
import { useAiChatVisibility } from "../hooks/useAiChatVisibility";
import { useTranslation } from "react-i18next";
import { translateNavLabel } from "../i18n/navLabels";
import { usePermissions } from "../hooks/usePermissions";
import type { ThemePreference } from "../lib/theme";
import {
  MODULE_CATEGORIES,
  MODULE_DEFINITIONS,
  MODULES_BY_KEY,
  normalizeModuleSettings,
  settingsToDisabledModules,
  type ModuleKey,
} from "../lib/modules";

type SettingsTab = "workspace" | "modules" | "runtime";

export function SettingsPage() {
  const { t } = useTranslation();
  const society = useSociety();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: SettingsTab = requestedTab === "modules" || requestedTab === "runtime" ? requestedTab : "workspace";
  const { loaded: permissionsLoaded, can } = usePermissions();
  const canEditBranding = permissionsLoaded && can("society:write");
  const canEditSettings = permissionsLoaded && can("settings:write");
  const canManageModules = canEditSettings;
  const [demo, setDemo] = useState(isDemoMode());
  const appRuntime = resolveAppRuntime();
  const updateModules = usePermissionedMutation(api.society.updateModules, canEditSettings);
  const updateInventorySettings = usePermissionedMutation(api.society.updateInventorySettings, canEditSettings);
  const updateNotificationSettings = usePermissionedMutation(api.society.updateNotificationSettings, canEditSettings);
  // Logos use the dedicated branding-upload path, which stays available even
  // when native file storage is disabled (a logo isn't document content).
  const generateUploadUrl = usePermissionedMutation(api.files.generateLogoUploadUrl, canEditBranding);
  const setLogo = usePermissionedMutation(api.society.setLogo, canEditBranding);
  const clearLogo = usePermissionedMutation(api.society.clearLogo, canEditBranding);
  const setDarkLogo = usePermissionedMutation(api.society.setDarkLogo, canEditBranding);
  const clearDarkLogo = usePermissionedMutation(api.society.clearDarkLogo, canEditBranding);
  const setLetterhead = usePermissionedMutation(api.society.setLetterhead, canEditBranding);
  const clearLetterhead = usePermissionedMutation(api.society.clearLetterhead, canEditBranding);
  const setLogoInvertInDarkMode = usePermissionedMutation(api.society.setLogoInvertInDarkMode, canEditBranding);
  const seedSharedViews = usePermissionedMutation(api.views.seedGovernanceDataTableViews, canEditSettings);
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
  const [showDarkLogoSection, setShowDarkLogoSection] = useState(Boolean(society?.logoDarkUrl || society?.logoInvertInDarkMode));
  const [darkLogoMode, setDarkLogoMode] = useState<"invert" | "upload">(society?.logoDarkUrl ? "upload" : "invert");
  const [showLetterheadSection, setShowLetterheadSection] = useState(Boolean(society?.letterheadUrl));
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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const toggleModule = async (key: ModuleKey, checked: boolean) => {
    if (!canManageModules || savingModule) return;
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
    if (!canEditSettings) return;
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
    if (!society || !canEditBranding) return;
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
      let storageId: string;
      if (isLocalDataRuntime()) {
        storageId = await readFileDataUrl(file);
      } else {
        const uploadUrl = await generateUploadUrl({ societyId: society._id });
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        ({ storageId } = await res.json());
      }
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
    if (!society || !canEditBranding) return;
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
    if (!society || !canEditBranding) return;
    try {
      await setLogoInvertInDarkMode({ societyId: society._id, invert: checked });
    } catch (error) {
      toast.error("Couldn't update setting", error instanceof Error ? error.message : undefined);
    }
  };

  const changeRetention = async (value: string) => {
    if (!canEditSettings) return;
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
          { id: "workspace", label: t("settings.tabWorkspace", "Workspace") },
          { id: "modules", label: t("settings.tabModules", "Modules") },
          { id: "runtime", label: t("settings.tabRuntime", "Runtime") },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("tab", id);
          return next;
        }, { replace: true })}
      >

      {activeTab === "workspace" && (
      <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">{t("settings.logoTitle", "Organization logo")}</h2>
          <span className="card__subtitle">
            {t("settings.logoSubtitle", "Shown in the sidebar and on exported documents.")}
          </span>
        </div>
        <div className="card__body col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div
              className="organization-logo-preview organization-logo-preview--light"
              aria-label="Logo preview"
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
                  disabled={!canEditBranding || uploadingLogo === "light"}
                  onClick={() => lightLogoInputRef.current?.click()}
                >
                  {uploadingLogo === "light"
                    ? "Uploading…"
                    : society.logoUrl
                      ? "Replace logo"
                      : t("settings.uploadLogo", "Upload logo")}
                </button>
                {society.logoUrl && (
                  <button
                    type="button"
                    className="btn"
                    disabled={!canEditBranding || uploadingLogo === "light"}
                    onClick={() => { void removeLogoVariant("light"); }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
                {t("settings.logoFormats", "SVG, PNG, or JPG. Max 2 MB.")}
              </p>
            </div>
          </div>

          <Toggle
            disabled={!canEditBranding}
            checked={showDarkLogoSection}
            onChange={setShowDarkLogoSection}
            label={t("settings.logoDarkToggle", "Customize logo for dark mode")}
            hint={t("settings.logoDarkHint", "By default, the same logo is used in both themes.")}
          />

          {showDarkLogoSection && (
            <div className="col" style={{ gap: 12, paddingLeft: 4 }}>
              <RadioGroup
                name="dark-logo-mode"
                value={darkLogoMode}
                onChange={async (val) => {
                  if (!canEditBranding) return;
                  if (val === "invert" && society.logoDarkUrl) {
                    const ok = await confirm({
                      title: "Switch to inverted logo?",
                      message: "This will remove your uploaded dark-mode logo and use an inverted version of the light logo instead.",
                      confirmLabel: "Switch",
                    });
                    if (!ok) return;
                    await clearDarkLogo({ societyId: society._id });
                  }
                  setDarkLogoMode(val);
                  if (val === "invert") {
                    void toggleLogoInvert(true);
                  } else if (val === "upload" && society.logoInvertInDarkMode) {
                    void toggleLogoInvert(false);
                  }
                }}
                options={[
                  { value: "invert", disabled: !canEditBranding, label: "Invert the light logo", hint: "Works best for monochrome (black-line) logos." },
                  { value: "upload", disabled: !canEditBranding, label: "Upload a separate logo", hint: "Use a different file optimized for dark backgrounds." },
                ]}
              />

              <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div
                  className={`organization-logo-preview organization-logo-preview--dark${
                    darkLogoMode === "invert" && !society.logoDarkUrl && society.logoUrl
                      ? " organization-logo-preview--invert"
                      : ""
                  }`}
                  aria-label="Dark mode preview"
                >
                  {darkLogoMode === "upload" && society.logoDarkUrl ? (
                    <img src={society.logoDarkUrl} alt="" className="organization-logo-preview__img" />
                  ) : society.logoUrl ? (
                    <img src={society.logoUrl} alt="" className="organization-logo-preview__img" />
                  ) : (
                    <span className="organization-logo-preview__placeholder organization-logo-preview__placeholder--dark">
                      {(society.name ?? "S")[0].toUpperCase()}
                    </span>
                  )}
                </div>

                {darkLogoMode === "upload" && (
                  <div className="col" style={{ gap: 6, flex: "1 1 auto", minWidth: 200 }}>
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
                        disabled={!canEditBranding || uploadingLogo === "dark"}
                        onClick={() => darkLogoInputRef.current?.click()}
                      >
                        {uploadingLogo === "dark"
                          ? "Uploading…"
                          : society.logoDarkUrl
                            ? "Replace logo"
                            : t("settings.uploadLogo", "Upload logo")}
                      </button>
                      {society.logoDarkUrl && (
                        <button
                          type="button"
                          className="btn"
                          disabled={!canEditBranding || uploadingLogo === "dark"}
                          onClick={() => { void removeLogoVariant("dark"); }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <Toggle
            disabled={!canEditBranding}
            checked={showLetterheadSection}
            onChange={setShowLetterheadSection}
            label={t("settings.letterheadToggle", "Use a custom document letterhead")}
            hint={t("settings.letterheadHint", "Header image for exported minutes, meeting packs, and the public copy.")}
          />

          {showLetterheadSection && (
            <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap", paddingLeft: 4 }}>
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
                    disabled={!canEditBranding || uploadingLogo === "letterhead"}
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
                      disabled={!canEditBranding || uploadingLogo === "letterhead"}
                      onClick={() => { void removeLogoVariant("letterhead"); }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Leave empty for unbranded exports.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-pair" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">{t("settings.languageTitle")}</h2>
            <span className="card__subtitle">{t("settings.languageSubtitle")}</span>
          </div>
          <div className="card__body row" style={{ gap: 8 }}>
            {/* The card heading already says "Language"; the switcher keeps its aria-label. */}
            <LocaleSwitcher compact />
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2 className="card__title">{t("settings.appearanceTitle")}</h2></div>
          <div className="card__body row settings-appearance" style={{ gap: 8 }}>
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
          <h2 className="card__title">{t("settings.sidebarTitle", "Sidebar")}</h2>
          <span className="card__subtitle">{t("settings.sidebarSubtitle", "Choose which sidebar sections show in your workspace.")}</span>
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
          <h2 className="card__title">{t("settings.aiTitle", "AI assistant")}</h2>
          <span className="card__subtitle">{t("settings.aiSubtitle", "Show or hide the in-app AI chat features.")}</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <Toggle
            checked={!aiChatHidden}
            onChange={(checked) => setAiChatHidden(!checked)}
            label={t("settings.aiToggle", "Enable AI chat")}
            hint={t("settings.aiToggleHint")}
          />
        </div>
      </div>
      </>
      )}

      {activeTab === "modules" && (
      <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">{t("settings.modulesTitle")}</h2>
          <span className="card__subtitle">{t("settings.modulesSubtitle")}</span>
        </div>
        <div className="card__body col" style={{ gap: 16 }}>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            {t("settings.modulesHint")}
            {" "}{t("settings.modulesAccessNote")}
            {!canManageModules && ` ${t("settings.modulesOwnerOnly")}`}
          </div>
          <Link to="/app/users" className="btn btn--ghost btn--sm" style={{ alignSelf: "flex-start" }}>
            {t("settings.viewUsersAccess")}
          </Link>

          <div className="settings-modules">
            {modulesByCategory.map(({ category, items }) => (
              <div key={category} className="card" style={{ background: "var(--bg-base)" }}>
                <div className="card__head">
                  <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>{t(`moduleCategories.${category}`, category)}</h3>
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
                        disabled={!canManageModules || savingModule !== null}
                        label={t(`modules.${module.key}.label`, module.label)}
                        hint={t(`modules.${module.key}.description`, module.description)}
                      />
                      <div className="muted" style={{ fontSize: "var(--fs-sm)", paddingLeft: 42, marginTop: 4 }}>
                        {t("settings.moduleIncludes", { items: module.includes.map((item) => translateNavLabel(t, item)).join(", ") })}
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
          <h2 className="card__title">{t("settings.inventoryTitle", "Inventory")}</h2>
          <span className="card__subtitle">{t("settings.inventorySubtitle")}</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <Toggle
            checked={inventoryPromptEnabled}
            onChange={toggleConsumablePrompt}
            disabled={!canEditSettings || savingInventorySettings}
            label={t("settings.inventoryPrompt", "Prompt for current count when adding consumables")}
            hint={t("settings.inventoryPromptHint")}
          />
        </div>
      </div>
      </>
      )}

      {activeTab === "runtime" && (
      <>
      <WorkspaceStorageCard />
      <DocumentStorageSettingsCard />

      <div className="settings-pair" style={{ marginBottom: 16 }}>
        <IdentitySessionSettingsCard />

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">{t("settings.backendTitle", "Backend connection")}</h2>
            <Badge tone={appRuntime.kind === "server" ? "info" : "neutral"}>
              {appRuntime.kind === "server" ? "Configured" : "Not used"}
            </Badge>
          </div>
          <div className="card__body col">
            {/* Report what the app actually resolved, not just the build-time
                variable — a device set up for local-first storage never opens a
                backend connection at all, and saying otherwise is misleading. */}
            {appRuntime.kind === "server" ? (
              <div className="muted">
                Backend: <code className="mono">{appRuntime.url}</code>{" "}
                <span style={{ fontSize: "var(--fs-xs)" }}>
                  ({appRuntime.source === "stored" ? "chosen during setup" : appRuntime.source === "build" ? "from VITE_CONVEX_URL" : "development default"})
                </span>
              </div>
            ) : (
              <div className="muted">
                This device runs without a backend — records are stored locally. Change that under{" "}
                <strong>Workspace storage</strong> above.
              </div>
            )}
            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Run <code className="mono">npx convex dev</code> for cloud, or self-host from{" "}
              <a href="https://github.com/get-convex/convex-backend" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                get-convex/convex-backend
              </a>
              . See <code className="mono">README.md</code>.
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">{t("settings.notificationsTitle", "Notifications")}</h2>
          <span className="card__subtitle">{t("settings.notificationsSubtitle")}</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <div className="settings-row" style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{t("settings.keepClearedFor")}</div>
              <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                When you clear a notification it leaves the bell immediately, but stays on the
                Notifications page under “Dismissed” for this long before it’s permanently deleted.
              </div>
            </div>
            <div style={{ flexShrink: 0, minWidth: 160 }}>
              <Select
                value={retentionDays}
                onChange={changeRetention}
                disabled={!canEditSettings || savingRetention}
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
        <div className="card__head"><h2 className="card__title">{t("settings.demoTitle", "Demo mode")}</h2></div>
        <div className="card__body col">
          <Toggle
            checked={demo}
            onChange={(v) => {
              setDemoMode(v);
              setDemo(v);
            }}
            label={t("settings.demoToggle", "Show demo banner and allow seeding a fake society")}
          />
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Append <code className="mono">?demo=1</code> to any URL to force-enable, <code className="mono">?demo=0</code> to disable.
          </div>
        </div>
      </div>

      <div
        className="card"
        style={{ marginBottom: 16, borderColor: "var(--danger)" }}
      >
        <div className="card__head">
          <AlertTriangle size={16} style={{ color: "var(--danger)", flexShrink: 0 }} />
          <h2 className="card__title">{t("settings.dangerTitle", "Danger zone")}</h2>
          <Badge tone="danger">{t("settings.irreversible")}</Badge>
        </div>
        <div className="card__body col" style={{ gap: 20 }}>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            These actions seed or permanently remove data. Double-check before using them.
          </div>

          <div className="col" style={{ gap: 8 }}>
            <div style={{ fontWeight: 500 }}>{t("settings.sharedViews")}</div>
            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Seed shared governance views for board work, filings, attestations, conflicts, and grants.
            </div>
            <div className="row">
              <button
                className="btn btn--accent"
                disabled={!canEditSettings || sharedViewsBusy}
                onClick={async () => {
                  if (!canEditSettings) return;
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

          <div className="col" style={{ gap: 8, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 500 }}>{t("settings.demoData")}</div>
            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Seed a fake demo society, or wipe every table in this deployment. Wiping cannot be undone.
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
      </div>

      </>
      )}
      </SettingsShell>
    </div>
  );
}
