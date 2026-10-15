/**
 * TEMPORARY STUB (workstream C). Workstream B owns this file: its version,
 * which reads `api.organizationSetup.progress`, replaces this one at merge.
 *
 * Until then this approximates the progress from queries that already exist
 * (the society row, `dashboard.summary` and the role-holder register) so the
 * Dashboard summary card, the shell pill and the "Back to setup" banner can be
 * built and exercised against real workspace data. Step keys, titles and
 * destinations follow the design catalogue.
 */
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { usePermissions } from "@/hooks/usePermissions";
import { interfaceRouteReadPermission } from "../../../shared/interfaceRouteAccess";
import { isCorporation } from "../../../shared/organizationDomain";
import type {
  OrganizationSetupProgress,
  SetupPhaseKey,
  SetupPhaseView,
  SetupStepKey,
  SetupStepState,
  SetupStepView,
  SetupVariant,
} from "../../../shared/organizationSetup/types";

type Draft = Omit<SetupStepView, "state" | "optional" | "allowNotApplicable"> & {
  state: Exclude<SetupStepState, "restricted" | "later" | "not_applicable">;
  optional?: boolean;
  allowNotApplicable?: boolean;
};

const PHASE_ORDER: SetupPhaseKey[] = ["prepare", "file", "organize", "maintain"];

const isCorporationRow = (society: any) => isCorporation(society);

function variantOf(society: any): SetupVariant {
  const status = String(society?.formationStatus ?? "");
  if (status === "preparing" || status === "submitted") return isCorporationRow(society) ? "corporation_preparing" : "society_preparing";
  if (status === "incorporated") {
    try {
      const answers = JSON.parse(society?.onboardingAnswersJson ?? "{}");
      if (answers?.organizationStage === "preparing") return isCorporationRow(society) ? "corporation_preparing" : "society_preparing";
    } catch {
      /* unreadable answers: treat as an existing organization */
    }
  }
  return "existing";
}

export function useOrganizationSetup(societyId: string | null | undefined): OrganizationSetupProgress | undefined {
  const society = useSociety() as any;
  const { can } = usePermissions();
  const matches = Boolean(societyId && society?._id && String(society._id) === String(societyId));
  const corporation = isCorporationRow(society);
  const summary = useQuery(api.dashboard.summary, matches ? { societyId: society._id } : "skip") as any;
  const roleHolders = useQuery(
    api.legalOperations.listRoleHolders,
    matches && corporation && can("documents:read") ? { societyId: society._id } : "skip",
  ) as any[] | undefined;

  return useMemo(() => {
    if (!matches || !summary) return undefined;
    if (corporation && can("documents:read") && roleHolders === undefined) return undefined;
    const variant = variantOf(society);
    const status = String(society.formationStatus ?? "");
    const filed = status === "submitted" || status === "incorporated";
    const incorporated = status === "incorporated";
    const registry = /CA-FED|federal/i.test(String(society.jurisdictionCode ?? "")) ? "Corporations Canada" : corporation ? "the registry" : "BC Registries";
    const counts = summary.counts ?? {};
    const people = (roleType: string, statuses = ["proposed", "current"]) =>
      (roleHolders ?? []).filter((row: any) => row.roleType === roleType && statuses.includes(row.status ?? "current")).length;
    const directors = corporation ? people("director") : counts.directors ?? 0;
    const currentDirectors = corporation ? people("director", ["current"]) : counts.directors ?? 0;
    const upcomingAgm = (summary.upcomingMeetings ?? []).some((meeting: any) => meeting.type === "AGM");
    const calendar = (summary.upcomingFilings ?? []).length > 0 || (summary.overdueFilings ?? []).length > 0 || (counts.openDeadlines ?? 0) > 0;
    const done = (value: unknown): Draft["state"] => (value ? "done" : "todo");

    const maintain: Draft[] = [
      { key: "fiscal-year", phase: "maintain", title: "Set your financial year-end", description: "Used to schedule the annual meeting and tax filings.", state: done(society.fiscalYearEnd), to: "/app/compliance-settings", actionLabel: "Set year-end" },
      corporation
        ? { key: "annual-meeting", phase: "maintain", title: "Plan the first annual shareholders' meeting", description: "Hold it, or sign a written resolution instead, within 18 months of incorporating.", state: done(upcomingAgm), to: "/app/meetings", actionLabel: "Plan the meeting" }
        : { key: "agm", phase: "maintain", title: "Plan your AGM and annual report", description: "Hold an AGM each year and file the annual report within 30 days.", state: done(upcomingAgm), to: "/app/meetings", actionLabel: "Plan the AGM" },
      { key: "calendar", phase: "maintain", title: "Turn on filing reminders", description: "Track the annual return and other deadlines.", state: done(calendar), to: "/app/deadlines", actionLabel: "Open deadlines" },
      { key: "privacy", phase: "maintain", title: "Write down how you handle personal information", description: "A short privacy policy and who's responsible for it.", state: done(society.privacyPolicyDocId || society.privacyProgramStatus === "Ready"), to: "/app/privacy", optional: true, actionLabel: "Open privacy" },
    ];

    let drafts: Draft[];
    if (variant === "corporation_preparing") {
      drafts = [
        { key: "act", phase: "prepare", title: "Confirm where you're incorporating", description: "You chose this when you created the workspace.", state: done(society.actFormedUnder), to: "/app/society", actionLabel: "Review" },
        { key: "name", phase: "prepare", title: "Choose your corporation's name", description: "Use a numbered name, or pick a word name and get a NUANS name search report.", state: society.numbered ? "done" : "in_progress", note: society.numbered ? undefined : `Working name saved: ${society.name}`, to: "/app/formation-maintenance", action: "choose_name", actionLabel: "Choose a name" },
        { key: "office", phase: "prepare", title: "Add the registered office address", description: "The official address in Canada where legal notices are delivered.", state: done(society.registeredOfficeAddress), to: "/app/organization-details", actionLabel: "Add the address" },
        { key: "directors", phase: "prepare", title: "Name your first directors", description: "At least one person. At least 25% must be resident Canadians. Each director must agree to act.", state: done(directors > 0), to: "/app/role-holders?role=director", actionLabel: "Add directors" },
        { key: "shares", phase: "prepare", title: "Set out your share structure", description: "The classes of shares and the rights each class has. This goes into the articles.", state: "todo", to: "/app/rights-ledger", actionLabel: "Add share classes" },
        { key: "isc", phase: "prepare", title: "List people with significant control", description: "Anyone who owns or controls 25% or more.", state: done(people("controller") > 0), to: "/app/significant-individuals", allowNotApplicable: true, actionLabel: "Add people" },
        { key: "articles", phase: "prepare", title: "Prepare the articles of incorporation", description: "Name, office province, share classes, transfer limits and number of directors.", state: "todo", to: "/app/template-engine", actionLabel: "Start the articles" },
        { key: "review", phase: "prepare", title: "Have someone check it before you file", description: "Optional. Ask a second person to review your filing details.", state: "todo", to: "/app/post-incorporation", optional: true, actionLabel: "Ask for a review" },
        { key: "file", phase: "file", title: "File your incorporation online", description: `Open ${registry}'s service, enter the details you prepared, and pay the fee.`, state: done(filed), action: "mark_submitted", actionLabel: "I've filed it" },
        { key: "certificate", phase: "organize", title: "Record your certificate of incorporation", description: "Upload the certificate, then enter the corporation number and date shown on it.", state: done(incorporated), action: "record_certificate", actionLabel: "Record the certificate" },
        { key: "officers", phase: "organize", title: "Appoint officers", description: "Usually a president and a secretary. One person can hold both.", state: done(people("officer", ["current"]) > 0), to: "/app/role-holders?role=officer", allowNotApplicable: true, actionLabel: "Add officers" },
        { key: "issue-shares", phase: "organize", title: "Issue the first shares", description: "Record who got shares, how many, and what they paid.", state: "todo", to: "/app/rights-ledger", actionLabel: "Issue shares" },
        { key: "registers", phase: "organize", title: "Set up the minute book and registers", description: "Keep the articles, by-laws, resolutions and registers together.", state: done(currentDirectors > 0 && people("shareholder", ["current"]) > 0), to: "/app/minute-book", actionLabel: "Open the minute book" },
        { key: "business-number", phase: "organize", title: "Confirm your business number", description: "Record the CRA business number issued with the certificate.", state: done(["confirmed", "not_required"].includes(society.craBnStatus)), to: "/app/society", actionLabel: "Record it" },
        { key: "access", phase: "organize", title: "Invite the people who'll use Societyer", description: "Directors and shareholders don't get access automatically.", state: "todo", to: "/app/users", actionLabel: "Invite people" },
        ...maintain,
      ];
    } else if (variant === "society_preparing") {
      drafts = [
        { key: "act", phase: "prepare", title: "Confirm where you're incorporating", description: "A BC society under the Societies Act.", state: done(society.actFormedUnder), to: "/app/society", actionLabel: "Review" },
        { key: "name", phase: "prepare", title: "Reserve your society's name", description: "Get a name approved through BC Registries before you apply.", state: "in_progress", note: `Working name saved: ${society.name}`, to: "/app/formation-maintenance", action: "choose_name", actionLabel: "Record a name search" },
        { key: "constitution", phase: "prepare", title: "Write your constitution", description: "Your society's name and purposes.", state: done(society.constitutionDocId), to: "/app/documents", actionLabel: "Open documents" },
        { key: "bylaws", phase: "prepare", title: "Choose your bylaws", description: "Start from BC's model bylaws or write your own.", state: done(society.bylawsDocId), to: "/app/documents", actionLabel: "Open documents" },
        { key: "directors", phase: "prepare", title: "Name your first directors", description: "At least three, with at least one living in BC.", state: done(directors >= (society.isMemberFunded ? 1 : 3)), to: "/app/directors", actionLabel: "Add directors" },
        { key: "office", phase: "prepare", title: "Add the registered office address", description: "A BC address for delivering and mailing records.", state: done(society.registeredOfficeAddress), to: "/app/organization-details", actionLabel: "Add the address" },
        { key: "file", phase: "file", title: "Apply through Societies Online", description: "Open BC Registries, enter your details and pay the fee.", state: done(filed), action: "mark_submitted", actionLabel: "I've filed it" },
        { key: "certificate", phase: "organize", title: "Record your certificate of incorporation", description: "Upload the certificate, then enter the incorporation number and date shown on it.", state: done(incorporated), action: "record_certificate", actionLabel: "Record the certificate" },
        { key: "members", phase: "organize", title: "Add your first members", description: "Keep a register of members and their membership class.", state: done((counts.members ?? 0) > 0), to: "/app/members", actionLabel: "Add members" },
        { key: "access", phase: "organize", title: "Invite the people who'll use Societyer", description: "Directors and members don't get access automatically.", state: "todo", to: "/app/users", actionLabel: "Invite people" },
        ...maintain,
      ];
    } else {
      drafts = [
        { key: "certificate", phase: "prepare", title: "Upload your certificate of incorporation", description: "So Societyer can use the real incorporation date for deadlines.", state: done(incorporated), action: "record_certificate", actionLabel: "Record the certificate" },
        { key: "number", phase: "prepare", title: corporation ? "Add your corporation number" : "Add your society number", description: "As shown on the certificate.", state: done(society.incorporationNumber), to: "/app/society", actionLabel: "Add the number" },
        { key: "office", phase: "prepare", title: "Check the registered office address", description: "Where legal notices are delivered.", state: done(society.registeredOfficeAddress), to: "/app/organization-details", actionLabel: "Check the address" },
        { key: "directors", phase: "file", title: "Add your current directors", description: "The people on the board today.", state: done(currentDirectors > 0), to: corporation ? "/app/role-holders?role=director" : "/app/directors", actionLabel: "Add directors" },
        { key: "owners", phase: "file", title: corporation ? "Add your shareholders" : "Add your members", description: corporation ? "Who holds shares today." : "Who belongs to the society today.", state: done(corporation ? people("shareholder", ["current"]) > 0 : (counts.members ?? 0) > 0), to: corporation ? "/app/role-holders?role=shareholder" : "/app/members", actionLabel: corporation ? "Add shareholders" : "Add members" },
        { key: "governing-docs", phase: "organize", title: corporation ? "Upload your articles and by-laws" : "Upload your constitution and bylaws", description: "The signed copies you already have.", state: done(corporation ? society.constitutionDocId : society.constitutionDocId && society.bylawsDocId), to: "/app/documents", actionLabel: "Upload documents" },
        ...(corporation ? [{ key: "shares" as const, phase: "organize" as const, title: "Record your share classes and who holds them", description: "Classes, rights and current holdings.", state: "todo" as const, to: "/app/rights-ledger", actionLabel: "Open the share register" }] : []),
        { key: "access", phase: "organize", title: "Invite the people who'll use Societyer", description: "People on your registers don't get access automatically.", state: "todo", to: "/app/users", actionLabel: "Invite people" },
        ...maintain,
      ];
    }

    const readable = (to?: string) => {
      if (!to) return true;
      const permission = interfaceRouteReadPermission(to.split(/[?#]/)[0]);
      if (!permission) return true;
      return Boolean(summary.readAccess?.includes(permission)) || can(permission);
    };
    const steps: SetupStepView[] = drafts.map((draft) => ({
      ...draft,
      optional: draft.optional ?? false,
      allowNotApplicable: draft.allowNotApplicable ?? false,
      state: draft.state !== "done" && !readable(draft.to) ? "restricted" : draft.state,
    }));

    const phaseCopy: Record<SetupVariant, Record<SetupPhaseKey, [string, string]>> = {
      corporation_preparing: {
        prepare: ["Get ready to file", `Gather what ${registry} will ask for. Nothing here files anything.`],
        file: [`File with ${registry}`, `You file online with ${registry} and pay the fee there. Societyer doesn't file for you.`],
        organize: ["After your certificate arrives", "Your corporation exists from the date on the certificate. These steps organize it."],
        maintain: ["Keep it in good standing", "Yearly tasks. Societyer reminds you when each is due."],
      },
      society_preparing: {
        prepare: ["Get ready to apply", "Gather what BC Registries will ask for. Nothing here files anything."],
        file: ["Apply to BC Registries", "You apply online and pay the fee there. Societyer doesn't file for you."],
        organize: ["After your society is incorporated", "These steps organize your new society."],
        maintain: ["Keep it in good standing", "Yearly tasks. Societyer reminds you when each is due."],
      },
      existing: {
        prepare: ["Confirm the basics", "The details on your certificate."],
        file: ["Add your people", "Who runs and owns the organization today."],
        organize: ["Add your records", "Bring in the documents you already keep."],
        maintain: ["Keep it in good standing", "Yearly tasks. Societyer reminds you when each is due."],
      },
    };
    const counted = (step: SetupStepView) => step.state !== "not_applicable";
    const isDone = (step: SetupStepView) => step.state === "done";
    const open = (step: SetupStepView) => !["done", "not_applicable"].includes(step.state);
    const phaseSteps = (key: SetupPhaseKey) => steps.filter((step) => step.phase === key);

    let currentPhase: SetupPhaseKey;
    if (variant === "existing") {
      currentPhase = PHASE_ORDER.find((key) => phaseSteps(key).some((step) => open(step) && !step.optional)) ?? "maintain";
    } else if (status === "submitted") {
      currentPhase = "file";
    } else if (incorporated) {
      currentPhase = phaseSteps("organize").some((step) => open(step) && !step.optional) ? "organize" : "maintain";
    } else {
      currentPhase = phaseSteps("prepare").some((step) => open(step) && !step.optional) ? "prepare" : "file";
    }
    const currentIndex = PHASE_ORDER.indexOf(currentPhase);
    const phases: SetupPhaseView[] = PHASE_ORDER.map((key, index) => {
      const list = phaseSteps(key);
      const total = list.filter(counted).length;
      const doneCount = list.filter(isDone).length;
      return {
        key,
        title: phaseCopy[variant][key][0],
        description: phaseCopy[variant][key][1],
        done: doneCount,
        total,
        status: key === "maintain" ? "ongoing" : index < currentIndex || (total > 0 && doneCount === total) ? "complete" : index === currentIndex ? "current" : "upcoming",
        statusNote: key === "file" && status === "submitted" ? `Waiting for ${registry}` : undefined,
        steps: list,
      };
    });
    const pickable = (step: SetupStepView) => ["todo", "in_progress"].includes(step.state);
    const nextStep =
      (status === "submitted" ? steps.find((step) => step.key === "certificate") : undefined) ??
      phaseSteps(currentPhase).find(pickable) ??
      PHASE_ORDER.slice(currentIndex + 1).map((key) => phaseSteps(key).find(pickable)).find(Boolean);
    const countedSteps = steps.filter((step) => step.phase !== "maintain" && counted(step));
    const doneCount = countedSteps.filter(isDone).length;
    return {
      variant,
      currentPhase,
      phases,
      next: nextStep ? { key: nextStep.key as SetupStepKey, title: nextStep.title, to: nextStep.to, action: nextStep.action } : undefined,
      counts: { done: doneCount, total: countedSteps.length },
      complete: countedSteps.every((step) => step.state === "done" || step.state === "not_applicable" || step.state === "later"),
    };
    // `society` changes identity on every write, which is what we want here.
  }, [matches, summary, roleHolders, society, corporation, can]);
}
