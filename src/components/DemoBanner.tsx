import { isDemoMode } from "../lib/demoMode";
import { Building2, Check, ChevronDown, RefreshCw, Sparkles, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useConfirm } from "./Modal";
import { useToast } from "./Toast";
import { Menu, type MenuSection } from "./Menu";
import { actAsLocalUser, useLocalActorChoices } from "./UserPicker";
import { setStoredSocietyId, useSocieties, useSociety } from "../hooks/useSociety";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { maintenanceErrorMessage, resetDemoData, seedCorporationDemoWorkspace, seedDemoSociety } from "../lib/maintenanceApi";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";
import { corporationDemoSocietyId, isCorporationDemoKey } from "../../shared/demoData/corporationIdentities";
import { DEMO_PERSONAS, demoPersonaWorkspaceValues, personaForOrganization, type DemoPersona } from "../lib/demoPersonas";
import { useAuth } from "../auth/AuthProvider";

export function DemoBanner() {
  const demo = isDemoMode();
  const society = useSociety();
  const societies = useSocieties();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const auth = useAuth();
  const users = useLocalActorChoices();
  const currentUser = useCurrentUser();
  const currentUserId = useCurrentUserId();
  const createWorkspace = useMutation(api.society.createWorkspace);
  const [busy, setBusy] = useState<"seed" | "reset" | "persona" | null>(null);
  const { t } = useTranslation();

  // Every workspace in the bundled demo is a demo, including ones created
  // from the persona switch (they carry no demoMode flag).
  if (!demo || society === undefined || (society && !society.demoMode && !isStaticDemoRuntime())) return null;

  const role = currentUser?.role ?? null;
  const currentPersona = personaForOrganization(society);
  const localDemo = isLocalDataRuntime();
  // The generated sample company this workspace is, if any (not a company someone set up themselves).
  const currentDemoCorporation = isCorporationDemoKey(currentPersona) && society && society._id === corporationDemoSocietyId(currentPersona) ? currentPersona : null;
  const personaSelected = (key: DemoPersona["key"]) => (key === "bc_society" || !localDemo ? key === currentPersona : key === currentDemoCorporation);
  const organizationNoun = currentPersona === "bc_company" ? "company" : currentPersona && currentPersona !== "bc_society" ? "corporation" : "society";

  const reseed = async () => {
    setBusy("seed");
    try {
      const result = await seedDemoSociety();
      // Reseeding from a sample company restores that company too, and keeps it open.
      if (localDemo && currentDemoCorporation) {
        const company = await seedCorporationDemoWorkspace(currentDemoCorporation);
        setStoredSocietyId(company.societyId);
        toast.success("Demo data reseeded", `${society?.name ?? "The sample company"} is back to its sample records.`);
        return;
      }
      setStoredSocietyId(result.societyId);
      toast.success("Demo society seeded");
    } catch (error) {
      toast.error(maintenanceErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const wipe = async () => {
    const ok = await confirm({
      title: "Wipe all demo data?",
      message: localDemo
        ? "Every change is discarded and the sample companies you opened are removed. The demo starts again from Riverside Community Society."
        : "Every table will be dropped. You can reseed immediately after.",
      confirmLabel: "Wipe",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("reset");
    try {
      await resetDemoData();
      setStoredSocietyId(null);
      toast.success("Demo data wiped");
    } catch (error) {
      toast.error(maintenanceErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const switchPersona = async (persona: DemoPersona) => {
    if (personaSelected(persona.key)) return;
    // In the in-browser demo each corporation persona is a populated sample
    // workspace with fixed ids: seed it once, then reopen it.
    if (localDemo && isCorporationDemoKey(persona.key)) {
      setBusy("persona");
      try {
        const result = await seedCorporationDemoWorkspace(persona.key);
        setStoredSocietyId(result.societyId);
        toast.success(result.created ? `Opened ${persona.sample.name}` : `Switched to ${persona.sample.name}`, result.created ? `A sample ${persona.label} with its share register, resolutions and filings.` : persona.label);
        navigate("/app");
      } catch (error) {
        toast.error(`Couldn't open a ${persona.label} workspace`, error instanceof Error ? error.message : undefined);
      } finally {
        setBusy(null);
      }
      return;
    }
    const existing = (societies ?? []).find((candidate) => personaForOrganization(candidate) === persona.key);
    if (existing) {
      setStoredSocietyId(existing._id);
      toast.success(`Switched to ${existing.name}`, persona.label);
      navigate("/app");
      return;
    }
    setBusy("persona");
    try {
      if (persona.key === "bc_society") {
        const result = await seedDemoSociety();
        setStoredSocietyId(result.societyId);
        toast.success("Demo society seeded", persona.label);
      } else {
        const result = await createWorkspace(demoPersonaWorkspaceValues(persona) as any);
        auth.refreshMembership(result.societyId);
        setStoredSocietyId(result.societyId);
        toast.success(`Created ${persona.sample.name}`, `A starter ${persona.label} workspace with its setup checklist.`);
      }
      navigate("/app");
    } catch (error) {
      toast.error(`Couldn't open a ${persona.label} workspace`, error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const roleItems: MenuSection["items"] = (users ?? []).map((user) => ({
    id: `user-${user._id}`,
    label: user.displayName,
    hint: user.role,
    icon: user._id === currentUserId ? <Check size={14} /> : <UserRound size={14} />,
    onSelect: () => {
      if (user._id === currentUserId) return;
      actAsLocalUser(user._id);
      toast.info(`Viewing as ${user.role}`, `Previewing what the ${user.role} role can see and do.`);
    },
  }));

  const personaItems: MenuSection["items"] = DEMO_PERSONAS.map((persona) => ({
    id: `persona-${persona.key}`,
    label: persona.label,
    hint: persona.hint,
    icon: personaSelected(persona.key) ? <Check size={14} /> : <Building2 size={14} />,
    disabled: busy !== null,
    onSelect: () => void switchPersona(persona),
  }));

  const roleSections: MenuSection[] = [{ id: "roles", label: "View as", items: roleItems }];
  const personaSections: MenuSection[] = [{ id: "personas", label: "Try another organization type", items: personaItems }];
  const phoneSections: MenuSection[] = [
    ...(roleItems.length
      ? [{ id: "roles", label: role ? `Previewing what the ${role} role can see and do` : "View as", items: roleItems }]
      : []),
    // The sheet is narrow: names only, without the Act hints.
    { ...personaSections[0], items: personaItems.map(({ hint: _hint, ...item }) => item) },
    {
      id: "data",
      label: "Demo data",
      items: [
        { id: "reseed", label: society ? t("demo.reseed", "Reseed") : "Seed demo society", icon: <RefreshCw size={14} />, disabled: busy !== null, onSelect: () => void reseed() },
        ...(society ? [{ id: "wipe", label: t("demo.wipe", "Wipe"), icon: <Trash2 size={14} />, destructive: true, disabled: busy !== null, onSelect: () => void wipe() }] : []),
      ],
    },
  ];

  return (
    <div className="demo-banner" data-demo-banner="">
      <Sparkles size={14} />
      <span className="demo-banner__copy">
        <strong>{t("demo.label", "Demo mode.")}</strong>{" "}
        <span className="demo-banner__detail">
          {society
            ? role
              ? `Previewing what the ${role} role can see and do in ${society.name}${society.name.endsWith(".") ? "" : "."}`
              : organizationNoun === "company"
                ? t("demo.viewingCompany", { name: society.name, defaultValue: "Viewing {{name}} — a demo company used to showcase the app." })
                : organizationNoun === "corporation"
                  ? t("demo.viewingCorporation", { name: society.name, defaultValue: "Viewing {{name}} — a demo corporation used to showcase the app." })
                  : t("demo.viewing", { name: society.name, defaultValue: "Viewing {{name}} — a demo society used to showcase the app." })
            : "No demo society yet. Click Seed to load Riverside Community Society."}
        </span>
      </span>
      <div className="demo-banner__spacer" />
      <div className="demo-banner__actions">
        {society && roleItems.length > 0 && (
          <Menu
            align="right"
            minWidth={240}
            sections={roleSections}
            trigger={
              <button type="button" className="btn btn--sm btn--ghost demo-banner__switch" aria-haspopup="menu" aria-label={`Viewing as ${role ?? "user"}. Switch role`}>
                Viewing as <strong>{role ?? "…"}</strong> <ChevronDown size={12} aria-hidden="true" />
              </button>
            }
          />
        )}
        {society && (
          <Menu
            align="right"
            minWidth={260}
            sections={personaSections}
            trigger={
              <button type="button" className="btn btn--sm btn--ghost demo-banner__switch" aria-haspopup="menu" disabled={busy !== null}>
                <Building2 size={12} aria-hidden="true" /> {busy === "persona" ? "Opening…" : "Try another organization type"} <ChevronDown size={12} aria-hidden="true" />
              </button>
            }
          />
        )}
        <button className="btn btn--sm btn--ghost" disabled={busy !== null} onClick={() => void reseed()}>
          <RefreshCw size={12} />
          {society ? t("demo.reseed", "Reseed") : "Seed demo society"}
        </button>
        {society && (
          <button className="btn btn--sm btn--ghost" disabled={busy !== null} onClick={() => void wipe()}>
            {t("demo.wipe", "Wipe")}
          </button>
        )}
      </div>
      {/* Phones: one compact trigger opens every demo control in a sheet. */}
      <div className="demo-banner__compact">
        <Menu
          align="right"
          minWidth={260}
          sections={phoneSections}
          trigger={
            <button type="button" className="btn btn--sm btn--ghost demo-banner__switch" aria-haspopup="menu" aria-label={`Demo controls. Viewing as ${role ?? "user"}`}>
              Demo · <strong>{role ?? "Options"}</strong> <ChevronDown size={12} aria-hidden="true" />
            </button>
          }
        />
      </div>
    </div>
  );
}
