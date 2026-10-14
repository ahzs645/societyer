import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Building2,
  Calendar,
  CalendarClock,
  ClipboardCheck,
  FileCheck2,
  ShieldCheck,
  UploadCloud,
  UserRoundCheck,
} from "lucide-react";
import type { ComponentType } from "react";
import { api } from "@/lib/convexApi";
import { interfaceRouteReadPermission } from "../../shared/interfaceRouteAccess";
import { organizationVocabulary, type OrganizationVocabulary } from "../lib/organizationVocabulary";
import { useSociety } from "./useSociety";
import { usePermissions } from "./usePermissions";

/**
 * The organization setup checklist (profile → people → governing documents →
 * fiscal year → compliance calendar → meetings → filings → privacy), shared by
 * the Dashboard's setup guide and the shell's activation pill.
 *
 * Dismissal is per organization and uses the Dashboard's storage key, so
 * hiding the guide in one place hides it in the other.
 */

export const HIDDEN_ONBOARDING_FLOW_KEY = "societyer.dashboard.hiddenOnboardingFlowSocietyIds";
/** Same-tab sync: `storage` events only fire in other tabs. */
export const SETUP_GUIDE_VISIBILITY_EVENT = "societyer:setup-guide-visibility";

export type SetupStep = {
  id: string;
  title: string;
  description: string;
  to: string;
  complete: boolean;
  icon: ComponentType<{ size?: number | string }>;
};

export type SetupStepState = "complete" | "next" | "upcoming";

export function readHiddenOnboardingFlowSocietyIds(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_ONBOARDING_FLOW_KEY);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeHiddenOnboardingFlowSocietyIds(ids: string[]) {
  try {
    window.localStorage.setItem(HIDDEN_ONBOARDING_FLOW_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the choice lasts for this page view */
  }
  window.dispatchEvent(new CustomEvent(SETUP_GUIDE_VISIBILITY_EVENT, { detail: ids }));
}

/** The eight setup checks, worded for the organization's kind. */
export function getSetupSteps({
  society,
  counts,
  upcomingMeetings,
  upcomingFilings,
  overdueFilings,
  entityCopy,
  roleHolderCounts,
}: {
  society: any;
  counts: any;
  upcomingMeetings: any[];
  upcomingFilings: any[];
  overdueFilings: any[];
  entityCopy: OrganizationVocabulary;
  roleHolderCounts: { directors: number; shareholders: number };
}): SetupStep[] {
  const corporation = entityCopy.isCorporation;
  const hasSocietyProfile = Boolean(
    society?.name && society?.incorporationNumber && society?.registeredOfficeAddress,
  );
  const hasPeople = corporation
    ? roleHolderCounts.directors > 0 && roleHolderCounts.shareholders > 0
    : counts.members > 0 && counts.directors > 0;
  // Corporate by-laws are optional (and a BC company has articles only), so the
  // articles alone complete the corporate step.
  const hasCoreDocuments = corporation
    ? Boolean(society?.constitutionDocId)
    : Boolean(society?.constitutionDocId && society?.bylawsDocId);
  const hasAgmTiming = Boolean(
    society?.fiscalYearEnd && upcomingMeetings.some((meeting) => meeting.type === "AGM"),
  );
  const hasComplianceCalendar = upcomingFilings.length > 0 || overdueFilings.length > 0 || counts.openDeadlines > 0;
  const hasMeetings = counts.meetingsThisYear > 0;
  const hasFilingsEvidence = upcomingFilings.length > 0 || overdueFilings.length > 0;
  const hasPrivacyRecords = Boolean(society?.privacyPolicyDocId || society?.privacyProgramStatus === "Ready");

  return [
    {
      id: "profile",
      title: `Set up ${entityCopy.organizationNoun} profile`,
      description: hasSocietyProfile ? "Legal identity and registered office are recorded." : "Add the legal name, incorporation number, and registered office.",
      to: "/app/society",
      complete: hasSocietyProfile,
      icon: Building2,
    },
    {
      id: "people",
      title: corporation ? "Record directors and shareholders" : "Import members/directors",
      description: corporation
        ? hasPeople ? "Director and shareholder registers have current records." : "Add current directors, officers, and shareholders."
        : hasPeople ? "Member and director registers have active records." : "Bring in current member and director registers.",
      to: corporation ? "/app/role-holders" : "/app/imports",
      complete: hasPeople,
      icon: UserRoundCheck,
    },
    {
      id: "documents",
      title: corporation ? `Upload ${entityCopy.bcCompany ? "articles" : "articles/by-laws"}` : entityCopy.isSociety ? "Upload constitution/bylaws" : "Upload governing documents",
      description: hasCoreDocuments
        ? "Core governing documents are attached."
        : entityCopy.isSociety ? "Attach the filed constitution and current bylaws." : `Attach the ${entityCopy.governingDocuments}.`,
      to: "/app/documents",
      complete: hasCoreDocuments,
      icon: UploadCloud,
    },
    {
      id: "timing",
      title: `Confirm fiscal year and ${entityCopy.annualMeeting} timing`,
      description: hasAgmTiming ? `Fiscal year and the next ${entityCopy.annualMeeting} are visible.` : `Set the fiscal year end and schedule the next ${entityCopy.annualMeeting}.`,
      to: "/app/compliance-settings",
      complete: hasAgmTiming,
      icon: CalendarClock,
    },
    {
      id: "calendar",
      title: "Create annual compliance calendar",
      description: hasComplianceCalendar ? "Filing and deadline dates are being tracked." : "Create deadline and filing reminders for the year.",
      to: "/app/deadlines",
      complete: hasComplianceCalendar,
      icon: Calendar,
    },
    {
      id: "meetings",
      title: "Run meetings and minutes",
      description: hasMeetings ? "This year's meeting record is underway." : "Schedule meetings and capture minutes, motions, and decisions.",
      to: "/app/meetings",
      complete: hasMeetings,
      icon: ClipboardCheck,
    },
    {
      id: "filings",
      title: "Track filings and evidence",
      description: hasFilingsEvidence ? "Filing work is visible on the dashboard." : "Track annual reports, changes, confirmations, and evidence.",
      to: "/app/filings",
      complete: hasFilingsEvidence,
      icon: FileCheck2,
    },
    {
      id: "records",
      title: "Keep privacy/records inspection-ready",
      description: hasPrivacyRecords ? "Privacy or inspection readiness is documented." : "Record privacy controls, retention, and inspection readiness.",
      to: "/app/privacy",
      complete: hasPrivacyRecords,
      icon: ShieldCheck,
    },
  ];
}

export type SetupProgress = {
  steps: SetupStep[];
  completed: number;
  total: number;
  /** 0–100. */
  percent: number;
  next: SetupStep | null;
  allComplete: boolean;
  /** The user dismissed the guide for this organization. */
  hidden: boolean;
  /** Still reading the workspace. */
  loading: boolean;
  stateOf: (step: SetupStep) => SetupStepState;
  setHidden: (hidden: boolean) => void;
};

/** Per-organization dismissal, kept in sync across every reader in the tab. */
export function useSetupGuideHidden(societyId: string | null | undefined) {
  const [hiddenIds, setHiddenIds] = useState<string[]>(readHiddenOnboardingFlowSocietyIds);
  useEffect(() => {
    const sync = () => setHiddenIds(readHiddenOnboardingFlowSocietyIds());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === HIDDEN_ONBOARDING_FLOW_KEY) sync();
    };
    window.addEventListener(SETUP_GUIDE_VISIBILITY_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SETUP_GUIDE_VISIBILITY_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const hidden = Boolean(societyId && hiddenIds.includes(societyId));
  const setHidden = useCallback(
    (next: boolean) => {
      if (!societyId) return;
      const current = readHiddenOnboardingFlowSocietyIds();
      const ids = next
        ? Array.from(new Set([...current, societyId]))
        : current.filter((id) => id !== societyId);
      setHiddenIds(ids);
      writeHiddenOnboardingFlowSocietyIds(ids);
    },
    [societyId],
  );
  return { hidden, setHidden };
}

/**
 * Setup progress for the current organization. Skips its queries entirely
 * once the guide is dismissed, so a hidden pill costs nothing.
 */
export function useSetupProgress(): SetupProgress | null {
  const society = useSociety();
  const { can } = usePermissions();
  const societyId = society?._id ? String(society._id) : null;
  const { hidden, setHidden } = useSetupGuideHidden(societyId);
  const entityCopy = organizationVocabulary(society);
  const corporation = entityCopy.isCorporation;
  const data = useQuery(api.dashboard.summary, society && !hidden ? { societyId: society._id } : "skip");
  const roleHolders = useQuery(
    api.legalOperations.listRoleHolders,
    society && corporation && !hidden ? { societyId: society._id } : "skip",
  ) as any[] | undefined;

  return useMemo(() => {
    if (!society) return null;
    if (hidden || !data) {
      return {
        steps: [],
        completed: 0,
        total: 0,
        percent: 0,
        next: null,
        allComplete: false,
        hidden,
        loading: !hidden,
        stateOf: () => "upcoming",
        setHidden,
      };
    }
    const canRead = (permission: string) => data.readAccess?.includes(permission) ?? can(permission);
    const currentRoleHolders = (roleHolders ?? []).filter((row: any) => (row.status ?? "current") === "current");
    const roleHolderCounts = {
      directors: currentRoleHolders.filter((row: any) => row.roleType === "director").length,
      shareholders: currentRoleHolders.filter((row: any) => row.roleType === "shareholder").length,
    };
    const steps = getSetupSteps({
      society,
      counts: data.counts,
      upcomingMeetings: data.upcomingMeetings ?? [],
      upcomingFilings: data.upcomingFilings ?? [],
      overdueFilings: data.overdueFilings ?? [],
      entityCopy,
      roleHolderCounts,
    }).filter((step) => {
      const permission = interfaceRouteReadPermission(step.to);
      return !permission || canRead(permission);
    });
    const completed = steps.filter((step) => step.complete).length;
    const next = steps.find((step) => !step.complete) ?? null;
    return {
      steps,
      completed,
      total: steps.length,
      percent: steps.length ? Math.round((completed / steps.length) * 100) : 0,
      next,
      allComplete: steps.length > 0 && completed === steps.length,
      hidden,
      loading: false,
      stateOf: (step: SetupStep): SetupStepState =>
        step.complete ? "complete" : step.id === next?.id ? "next" : "upcoming",
      setHidden,
    };
    // entityCopy is derived from society.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [society, hidden, data, roleHolders, can, setHidden]);
}
