/**
 * TEMPORARY FALLBACK — delete this folder once `organizationSetup:progress`
 * and its mutations (workstream A) are in the tree.
 *
 * Builds an `OrganizationSetupProgress` in the browser from the society row
 * and a few existing queries, and keeps skip / filed / certificate decisions
 * in localStorage, so the setup view can be built, screenshotted and tested
 * before the real query lands. Nothing outside `fallback/` and the two
 * marked lines in `useOrganizationSetup.ts` / `useSetupActions.ts` may import
 * it. The wording follows the design doc (§3.3–3.5, §3.9) but A's catalogue
 * is the source of truth.
 */
import type {
  OrganizationSetupProgress,
  SetupPhaseKey,
  SetupPhaseView,
  SetupStepAction,
  SetupStepKey,
  SetupStepState,
  SetupStepView,
  SetupVariant,
} from "../../../../shared/organizationSetup/types";
import { PORTABLE_FUNCTIONS } from "../../../../shared/functions/registry";
import { interfaceRouteReadPermission } from "../../../../shared/interfaceRouteAccess";
import { incorporationPreparationForOrganization } from "../../../../shared/incorporationPreparation";
import { jurisdictionModuleContract } from "../../../../shared/jurisdictionWorkspace";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation } from "../../../../shared/organizationDomain";
import { readOnboardingAnswersJson } from "../../../../shared/onboarding";
import { incorporationActById } from "../../../../shared/incorporationActs";

/** True until the real query is registered (the lead deletes this at merge). */
export const SETUP_FALLBACK_ACTIVE = !PORTABLE_FUNCTIONS.some((fn) => fn.name === "organizationSetup:progress");

// ------------------------------------------------------------------ store

export type FallbackState = {
  decisions: Partial<Record<SetupStepKey, { decision: "not_applicable" | "later"; reason?: string }>>;
  formationStatus?: "submitted" | "incorporated" | "preparing";
  submittedOn?: string;
  reference?: string;
};

const EVENT = "societyer:setup-fallback";
const key = (societyId: string) => `societyer.setupFallback.${societyId}`;
const cache = new Map<string, FallbackState>();

export function readFallbackState(societyId: string): FallbackState {
  const cached = cache.get(societyId);
  if (cached) return cached;
  let state: FallbackState = { decisions: {} };
  try {
    const raw = localStorage.getItem(key(societyId));
    if (raw) state = { decisions: {}, ...JSON.parse(raw) };
  } catch { /* storage unavailable: in-memory only */ }
  cache.set(societyId, state);
  return state;
}

export function writeFallbackState(societyId: string, next: FallbackState) {
  cache.set(societyId, next);
  try { localStorage.setItem(key(societyId), JSON.stringify(next)); } catch { /* in-memory only */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeFallbackState(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

// ------------------------------------------------------------- derivation

export type FallbackFacts = {
  society: any;
  summary?: any;
  roleHolders?: any[];
  canRead: (permission: string) => boolean;
};

type Ctx = {
  s: any;
  corp: boolean;
  bcCompany: boolean;
  federal: boolean;
  registry: string;
  noun: string;
  formation: string;
  counts: any;
  roles: (type: string, current?: boolean) => number;
  upcomingAgm: boolean;
  filings: boolean;
  answers?: ReturnType<typeof readOnboardingAnswersJson>;
};

type Def = {
  key: SetupStepKey;
  phase: SetupPhaseKey;
  optional?: boolean;
  na?: boolean;
  to?: string;
  actionLabel?: string;
  action?: SetupStepAction;
  title: (c: Ctx) => string;
  description: (c: Ctx) => string;
  state: (c: Ctx) => "done" | "in_progress" | "todo";
  note?: (c: Ctx) => string | undefined;
};

const done = (value: unknown) => (value ? "done" : "todo") as "done" | "todo";

function maintainSteps(): Def[] {
  return [
    { key: "fiscal-year", phase: "maintain", to: "/app/compliance-settings", actionLabel: "Set the year-end", title: () => "Set your financial year-end", description: () => "Used to schedule the annual meeting and tax filings.", state: (c) => done(c.s.fiscalYearEnd) },
    { key: "annual-meeting", phase: "maintain", to: "/app/meetings", actionLabel: "Plan the meeting", title: (c) => c.corp ? "Plan the first annual shareholders' meeting" : "Plan your AGM and annual report", description: (c) => c.corp ? "Hold it, or sign a written resolution instead, within 18 months of incorporating." : "Hold an AGM each year and file the annual report within 30 days.", state: (c) => done(c.upcomingAgm) },
    { key: "calendar", phase: "maintain", to: "/app/deadlines", actionLabel: "Open deadlines", title: () => "Turn on filing reminders", description: () => "Track the annual return and other deadlines.", state: (c) => done(c.filings || c.counts.openDeadlines > 0) },
    { key: "privacy", phase: "maintain", optional: true, to: "/app/privacy", actionLabel: "Open privacy", title: () => "Write down how you handle personal information", description: () => "A short privacy policy and who's responsible for it.", state: (c) => done(c.s.privacyPolicyDocId || c.s.privacyProgramStatus === "Ready") },
  ];
}

function corporationPreparing(): Def[] {
  return [
    { key: "act", phase: "prepare", title: () => "Confirm where you're incorporating", description: (c) => c.federal ? "Federal, under the Canada Business Corporations Act. You chose this when you created the workspace." : "Under the Act you chose when you created the workspace.", state: (c) => done(c.s.jurisdictionCode && c.s.actFormedUnder) },
    { key: "name", phase: "prepare", action: "choose_name", to: "/app/formation-maintenance", actionLabel: "Record a name search", title: () => "Choose your corporation's name", description: (c) => c.federal ? "Use a numbered name, or pick a word name and get a NUANS name search report." : "Use a numbered name, or pick a word name and get it approved.", state: (c) => (c.s.numbered ? "done" : "in_progress"), note: (c) => c.s.numbered ? "Numbered name: the registry assigns it" : `Working name saved: ${c.s.name}` },
    { key: "office", phase: "prepare", to: "/app/society#more-organization-details", actionLabel: "Add the address", title: () => "Add the registered office address", description: () => "The official address in Canada where legal notices are delivered.", state: (c) => done(c.s.registeredOfficeAddress) },
    { key: "directors", phase: "prepare", to: "/app/role-holders?role=director", actionLabel: "Add directors", title: () => "Name your first directors", description: (c) => c.bcCompany ? "At least one director. There's no residency rule." : "At least one person. At least 25% must be resident Canadians. Each director must agree to act.", state: (c) => done(c.roles("director") > 0) },
    { key: "shares", phase: "prepare", to: "/app/rights-ledger", actionLabel: "Set up share classes", title: () => "Set out your share structure", description: () => "The classes of shares and the rights each class has. This goes into the articles.", state: (c) => (c.answers?.classDetails?.trim() ? "in_progress" : "todo"), note: (c) => c.answers?.classDetails?.trim() ? `Notes from setup: ${c.answers.classDetails.trim()}` : undefined },
    { key: "isc", phase: "prepare", na: true, to: "/app/significant-individuals", actionLabel: "Add people", title: (c) => c.bcCompany ? "Plan your transparency register" : "List people with significant control", description: (c) => c.bcCompany ? "Anyone who owns or controls 25% or more of the shares or votes." : "Anyone who owns or controls 25% or more. Corporations Canada asks for this when you file.", state: (c) => done(c.roles("controller") > 0) },
    { key: "articles", phase: "prepare", to: "/app/template-engine", actionLabel: "Start the articles worksheet", title: (c) => c.bcCompany ? "Prepare the incorporation agreement and articles" : "Prepare the articles of incorporation", description: () => "Name, office province, share classes, transfer limits and number of directors, ready to enter in the online form.", state: () => "todo" },
    { key: "review", phase: "prepare", optional: true, to: "/app/post-incorporation", actionLabel: "Ask for a review", title: () => "Have someone check it before you file", description: () => "Optional. Ask a second person to review your filing details.", state: () => "todo" },
    { key: "file", phase: "file", action: "mark_submitted", title: () => "File your incorporation online", description: (c) => `Open ${c.registry}'s service, enter the details you prepared, and pay the fee.`, state: (c) => done(c.formation === "submitted" || c.formation === "incorporated"), note: (c) => c.formation === "submitted" ? `Filed — waiting for ${c.registry}` : undefined },
    { key: "certificate", phase: "organize", action: "record_certificate", title: () => "Record your certificate of incorporation", description: () => "Upload the certificate, then enter the corporation number and date shown on it.", state: (c) => done(c.formation === "incorporated") },
    { key: "organize", phase: "organize", to: "/app/post-incorporation#hold-organizational-meeting", actionLabel: "Prepare the resolutions", title: () => "Pass your first resolutions", description: () => "Directors adopt the by-laws, appoint officers, authorize share issues and set up banking.", state: () => "todo" },
    { key: "officers", phase: "organize", na: true, to: "/app/role-holders?role=officer", actionLabel: "Add officers", title: () => "Appoint officers", description: () => "Usually a president and a secretary. One person can hold both.", state: (c) => done(c.roles("officer", true) > 0) },
    { key: "issue-shares", phase: "organize", to: "/app/rights-ledger", actionLabel: "Issue shares", title: () => "Issue the first shares", description: () => "Record who got shares, how many, and what they paid. Shares can only be issued once paid for.", state: () => "todo" },
    { key: "registers", phase: "organize", to: "/app/minute-book", actionLabel: "Open the minute book", title: () => "Set up the minute book and registers", description: () => "Keep the articles, by-laws, resolutions and the director, officer and shareholder registers together.", state: (c) => c.roles("director", true) && c.roles("shareholder", true) ? "done" : c.roles("director", true) || c.roles("shareholder", true) ? "in_progress" : "todo" },
    { key: "isc-register", phase: "organize", na: true, to: "/app/significant-individuals", actionLabel: "Open the register", title: () => "Keep the significant-control register", description: () => "Record each person with significant control, and update the register within 15 days of a change.", state: (c) => c.roles("controller", true) > 0 || c.s.iscRegisterEntryDate ? "done" : c.roles("controller") > 0 ? "in_progress" : "todo" },
    { key: "business-number", phase: "organize", to: "/app/society", actionLabel: "Record the number", title: () => "Confirm your business number", description: () => "Corporations Canada usually issues a CRA business number with the certificate. Record it.", state: (c) => ["confirmed", "not_required"].includes(c.s.craBnStatus) ? "done" : c.s.craBnStatus === "pending" ? "in_progress" : "todo" },
    { key: "provinces", phase: "organize", optional: true, na: true, to: "/app/society#more-organization-details", actionLabel: "Add registrations", title: () => "Register in provinces where you do business", description: () => "Each province you operate in may need its own registration.", state: () => "todo", note: (c) => c.answers?.operatingRegions?.trim() ? `You said you'll operate in: ${c.answers.operatingRegions.trim()}` : undefined },
    { key: "access", phase: "organize", to: "/app/users", actionLabel: "Invite people", title: () => "Invite the people who'll use Societyer", description: () => "Directors and shareholders don't get access automatically. Invite who needs it.", state: () => "todo" },
    ...maintainSteps(),
  ];
}

function societyPreparing(): Def[] {
  return [
    { key: "act", phase: "prepare", title: () => "Confirm where you're incorporating", description: () => "A BC society under the Societies Act.", state: (c) => done(c.s.jurisdictionCode && c.s.actFormedUnder) },
    { key: "name", phase: "prepare", to: "/app/formation-maintenance", actionLabel: "Record a name approval", title: () => "Reserve your society's name", description: () => "Get a name approved through BC Registries before you apply.", state: () => "in_progress", note: (c) => `Working name saved: ${c.s.name}` },
    { key: "constitution", phase: "prepare", to: "/app/document-catalog", actionLabel: "Draft the constitution", title: () => "Write your constitution", description: () => "Your society's name and purposes.", state: (c) => done(c.s.constitutionDocId) },
    { key: "bylaws", phase: "prepare", to: "/app/document-catalog", actionLabel: "Choose bylaws", title: () => "Choose your bylaws", description: () => "Start from BC's model bylaws or write your own.", state: (c) => done(c.s.bylawsDocId) },
    { key: "directors", phase: "prepare", to: "/app/directors", actionLabel: "Add directors", title: () => "Name your first directors", description: () => "At least three, with at least one living in BC. Member-funded societies need only one.", state: (c) => (c.counts.directors >= (c.s.isMemberFunded ? 1 : 3) ? "done" : c.counts.directors > 0 ? "in_progress" : "todo") },
    { key: "office", phase: "prepare", to: "/app/society#more-organization-details", actionLabel: "Add the address", title: () => "Add the registered office address", description: () => "A BC address for delivering and mailing records.", state: (c) => done(c.s.registeredOfficeAddress) },
    { key: "file", phase: "file", action: "mark_submitted", title: () => "Apply through Societies Online", description: () => "Open BC Registries, enter your details and pay the fee.", state: (c) => done(c.formation === "submitted" || c.formation === "incorporated") },
    { key: "certificate", phase: "organize", action: "record_certificate", title: () => "Record your certificate of incorporation", description: () => "Upload the certificate, then enter the society number and date shown on it.", state: (c) => done(c.formation === "incorporated") },
    { key: "members", phase: "organize", to: "/app/members", actionLabel: "Add members", title: () => "Add your first members", description: () => "Keep a register of members and their membership class.", state: (c) => done(c.counts.members > 0) },
    { key: "first-meeting", phase: "organize", to: "/app/meetings", actionLabel: "Plan the meeting", title: () => "Hold your first directors' meeting", description: () => "Confirm officers, banking and where records are kept.", state: () => "todo" },
    { key: "tax", phase: "organize", na: true, to: "/app/society", actionLabel: "Record tax accounts", title: () => "Check CRA accounts and charity status", description: () => "A business number, GST and charity registration are separate from incorporation.", state: (c) => done(c.s.craBnStatus && c.s.craBnStatus !== "unknown" && c.s.charityStatus && c.s.charityStatus !== "unknown") },
    { key: "access", phase: "organize", to: "/app/users", actionLabel: "Invite people", title: () => "Invite the people who'll use Societyer", description: () => "Directors and members don't get access automatically. Invite who needs it.", state: () => "todo" },
    ...maintainSteps(),
  ];
}

function existing(): Def[] {
  return [
    { key: "certificate", phase: "prepare", action: "record_certificate", title: () => "Upload your certificate of incorporation", description: () => "So Societyer can use the real incorporation date for deadlines.", state: (c) => done(c.formation === "incorporated") },
    { key: "number", phase: "prepare", to: "/app/society", actionLabel: "Add the number", title: (c) => `Add your ${c.noun} number`, description: (c) => `The number on your certificate or the ${c.registry} record.`, state: (c) => done(c.s.incorporationNumber) },
    { key: "office", phase: "prepare", to: "/app/society#more-organization-details", actionLabel: "Check the address", title: () => "Check the registered office address", description: () => "The official address where legal notices are delivered.", state: (c) => done(c.s.registeredOfficeAddress) },
    { key: "directors", phase: "file", actionLabel: "Add directors", title: () => "Add your current directors", description: () => "Everyone on the board today.", state: (c) => done(c.corp ? c.roles("director", true) > 0 : c.counts.directors > 0) },
    { key: "officers", phase: "file", na: true, to: "/app/role-holders?role=officer", actionLabel: "Add officers", title: () => "Add your officers", description: () => "For example the president, secretary and treasurer.", state: (c) => done(c.roles("officer", true) > 0) },
    { key: "owners", phase: "file", actionLabel: "Add people", title: (c) => c.corp ? "Add your shareholders" : "Add your members", description: (c) => c.corp ? "Who holds shares today." : "Everyone on your register of members.", state: (c) => done(c.corp ? c.roles("shareholder", true) > 0 : c.counts.members > 0) },
    { key: "isc-register", phase: "file", na: true, to: "/app/significant-individuals", actionLabel: "Open the register", title: () => "Add people with significant control", description: () => "Anyone who owns or controls 25% or more.", state: (c) => done(c.roles("controller", true) > 0 || c.s.iscRegisterEntryDate) },
    { key: "governing-docs", phase: "organize", to: "/app/documents", actionLabel: "Upload documents", title: (c) => c.corp ? "Upload your articles and by-laws" : "Upload your constitution and bylaws", description: () => "The signed versions you already have.", state: (c) => done(c.corp ? c.s.constitutionDocId : c.s.constitutionDocId && c.s.bylawsDocId) },
    { key: "shares", phase: "organize", to: "/app/rights-ledger", actionLabel: "Open the ledger", title: () => "Record your share classes and who holds them", description: () => "The classes in your articles and the current holdings.", state: () => "todo" },
    { key: "minute-book", phase: "organize", optional: true, to: "/app/minute-book", actionLabel: "Open the minute book", title: () => "Bring in past minutes and resolutions", description: () => "Optional. Keep the history in one place.", state: () => "todo" },
    { key: "access", phase: "organize", to: "/app/users", actionLabel: "Invite people", title: () => "Invite the people who'll use Societyer", description: () => "Board members don't get access automatically. Invite who needs it.", state: () => "todo" },
    ...maintainSteps(),
    { key: "meetings", phase: "maintain", to: "/app/meetings", actionLabel: "Open meetings", title: () => "Record this year's meetings", description: () => "Board and general meetings, with minutes.", state: (c) => done(c.counts.meetingsThisYear > 0) },
    { key: "filings", phase: "maintain", to: "/app/filings", actionLabel: "Open filings", title: () => "Track your registry filings", description: () => "Annual reports and changes you file with the registry.", state: (c) => done(c.filings) },
  ];
}

function phaseCopy(variant: SetupVariant, c: Ctx): Record<SetupPhaseKey, { title: string; description: string }> {
  const maintain = { title: "Keep it in good standing", description: "Yearly tasks. Societyer reminds you when each is due." };
  if (variant === "existing") return {
    prepare: { title: "Confirm the basics", description: "Make sure Societyer has the official details." },
    file: { title: "Add your people", description: `The people who run the ${c.noun}.` },
    organize: { title: "Add your records", description: "Bring in the documents and registers you already keep." },
    maintain,
  };
  if (variant === "society_preparing") return {
    prepare: { title: "Get ready to apply", description: "Gather what BC Registries will ask for. Nothing here files anything." },
    file: { title: "Apply to BC Registries", description: "You apply online with BC Registries and pay the fee there. Societyer doesn't file for you." },
    organize: { title: "After your society is incorporated", description: "Your society exists from the date on the certificate. These steps organize it." },
    maintain,
  };
  return {
    prepare: { title: "Get ready to file", description: `Gather what ${c.registry} will ask for. Nothing here files anything.` },
    file: { title: `File with ${c.registry}`, description: `You file online with ${c.registry} and pay the fee there. Societyer doesn't file for you.` },
    organize: { title: "After your certificate arrives", description: "Your corporation exists from the date on the certificate. These steps organize it." },
    maintain,
  };
}

function plainAnswers(answers: Ctx["answers"], corp: boolean): string[] | undefined {
  if (!answers) return undefined;
  const classes = corp ? "Share classes" : "Membership classes";
  // Only answers the founder actually gave: the untouched defaults
  // (needs_review / needs_review / add_later) are left out.
  const lines: string[] = [];
  if (answers.governanceStructure === "single_class") lines.push(corp ? "One class of shares" : "One membership class");
  if (answers.governanceStructure === "multiple_classes") lines.push(`${corp ? "Several classes of shares" : "Several membership classes"}${answers.classDetails.trim() ? `: ${answers.classDetails.trim()}` : ""}`);
  if (answers.governanceStructure === "needs_review" && answers.classDetails.trim()) lines.push(`${classes}: ${answers.classDetails.trim()}`);
  if (answers.governanceDocuments === "need_to_prepare") lines.push("Documents: you'll draft them here");
  if (answers.governanceDocuments === "available") lines.push("Documents: you have signed copies to upload");
  if (answers.peopleReadiness === "ready_to_add") lines.push("People: details ready to enter");
  if (answers.operatingRegions.trim()) lines.push(`Where you'll operate: ${answers.operatingRegions.trim()}`);
  return lines.length ? lines : undefined;
}

export function deriveFallbackProgress(facts: FallbackFacts, store: FallbackState): OrganizationSetupProgress {
  const s = facts.society;
  const corp = isCorporation(s);
  const jurisdiction = canonicalizeJurisdictionCode(homeJurisdictionCode(s));
  const formation = store.formationStatus ?? s.formationStatus ?? "";
  let answers: Ctx["answers"];
  try { answers = readOnboardingAnswersJson(s.onboardingAnswersJson); } catch { answers = undefined; }
  const act = incorporationActById(answers?.incorporationActId);
  const recordsOnly = act?.support === "records_only";
  const guide = incorporationPreparationForOrganization(s);
  const registry = corp && jurisdiction === "CA-FED-CBCA" ? "Corporations Canada" : !corp ? "BC Registries" : jurisdictionModuleContract(jurisdiction as any).registryPortalLabel;
  const roleRows = facts.roleHolders ?? [];
  const ctx: Ctx = {
    s,
    corp,
    bcCompany: corp && jurisdiction === "CA-BC",
    federal: jurisdiction === "CA-FED-CBCA",
    registry,
    noun: corp ? "corporation" : "society",
    formation,
    counts: facts.summary?.counts ?? { directors: 0, members: 0, openDeadlines: 0, meetingsThisYear: 0 },
    roles: (type, current) => roleRows.filter((row) => row.roleType === type && (current ? (row.status ?? "current") === "current" : ["proposed", "current", undefined].includes(row.status))).length,
    upcomingAgm: (facts.summary?.upcomingMeetings ?? []).some((meeting: any) => meeting.type === "AGM"),
    filings: (facts.summary?.upcomingFilings ?? []).length + (facts.summary?.overdueFilings ?? []).length > 0,
    answers,
  };
  const preparingStage = formation === "preparing" || formation === "submitted" || (formation === "incorporated" && answers?.organizationStage === "preparing");
  const variant: SetupVariant = preparingStage ? (corp ? "corporation_preparing" : "society_preparing") : "existing";
  const defs = (variant === "corporation_preparing" ? corporationPreparing() : variant === "society_preparing" ? societyPreparing() : existing())
    .filter((def) => !(recordsOnly && (def.key === "articles" || def.key === "organize" || def.key === "review")));

  const steps: SetupStepView[] = defs.map((def) => {
    let to = def.to;
    if (variant === "existing" && def.key === "directors") to = corp ? "/app/role-holders?role=director" : "/app/directors";
    if (variant === "existing" && def.key === "owners") to = corp ? "/app/role-holders?role=shareholder" : "/app/members";
    const computed = def.state(ctx);
    const decision = store.decisions[def.key];
    const permission = to ? interfaceRouteReadPermission(to.split(/[?#]/, 1)[0]) : undefined;
    let state: SetupStepState = computed;
    let note = def.note?.(ctx);
    if (computed !== "done" && decision?.decision === "not_applicable") { state = "not_applicable"; note = decision.reason; }
    else if (computed !== "done" && decision?.decision === "later") state = "later";
    else if (computed !== "done" && permission && !facts.canRead(permission)) state = "restricted";
    const isFile = def.key === "file";
    return {
      key: def.key,
      phase: def.phase,
      title: def.title(ctx),
      description: def.description(ctx),
      state,
      ...(note ? { note } : {}),
      optional: Boolean(def.optional),
      allowNotApplicable: Boolean(def.na),
      ...(to ? { to } : {}),
      ...(def.actionLabel ? { actionLabel: def.actionLabel } : {}),
      ...(def.action ? { action: def.action } : {}),
      ...(isFile && guide && !recordsOnly ? { externalUrl: guide.filingChannel.onlineUrl, externalLabel: `Open ${registry}` } : {}),
    };
  });

  const order: SetupPhaseKey[] = ["prepare", "file", "organize", "maintain"];
  const copy = phaseCopy(variant, ctx);
  // A phase is finished when every required step is done or decided.
  const settled = (step: SetupStepView) => step.optional || step.state === "done" || step.state === "not_applicable" || step.state === "later";
  const phaseSteps = (phase: SetupPhaseKey) => steps.filter((step) => step.phase === phase);
  const phaseComplete = (phase: SetupPhaseKey) => phaseSteps(phase).every(settled);

  let currentPhase: SetupPhaseKey;
  if (variant === "existing") currentPhase = order.find((phase) => phase !== "maintain" && !phaseComplete(phase)) ?? "maintain";
  else if (formation === "submitted") currentPhase = "file";
  else if (formation === "incorporated") currentPhase = phaseComplete("organize") ? "maintain" : "organize";
  else currentPhase = phaseComplete("prepare") ? "file" : "prepare";

  const phases: SetupPhaseView[] = order.map((phase) => {
    const list = phaseSteps(phase);
    // Steps put off with "Remind me later" drop to the bottom of their phase.
    const sorted = [...list.filter((step) => step.state !== "later"), ...list.filter((step) => step.state === "later")];
    const applicable = list.filter((step) => step.state !== "not_applicable");
    const index = order.indexOf(phase);
    const currentIndex = order.indexOf(currentPhase);
    const status: SetupPhaseView["status"] = phase === "maintain"
      ? (currentPhase === "maintain" || variant === "existing" || formation === "incorporated" ? "ongoing" : "upcoming")
      : phase === currentPhase ? "current" : phaseComplete(phase) && (index < currentIndex || list.length > 0) ? "complete" : "upcoming";
    return {
      key: phase,
      title: copy[phase].title,
      description: copy[phase].description,
      done: applicable.filter((step) => step.state === "done").length,
      total: applicable.length,
      status,
      ...(phase === "file" && formation === "submitted" ? { statusNote: `Waiting for ${registry}` } : {}),
      steps: sorted,
    };
  });

  const counted = steps.filter((step) => step.phase !== "maintain" && step.state !== "not_applicable");
  // Steps with nothing yet come before ones already under way (the name step
  // is "in progress" from the start because a working name is saved).
  const nextFrom = (phase: SetupPhaseKey) => phaseSteps(phase).find((step) => step.state === "todo" && !step.optional)
    ?? phaseSteps(phase).find((step) => step.state === "in_progress" && !step.optional);
  let next = nextFrom(currentPhase);
  if (formation === "submitted") next = steps.find((step) => step.key === "certificate");
  if (!next) next = order.slice(order.indexOf(currentPhase) + 1).map(nextFrom).find(Boolean);
  return {
    variant,
    currentPhase,
    phases,
    ...(next ? { next: { key: next.key, title: next.title, ...(next.to ? { to: next.to } : {}), ...(next.action ? { action: next.action } : {}) } } : {}),
    counts: { done: counted.filter((step) => step.state === "done").length, total: counted.length },
    complete: counted.every((step) => step.state === "done" || (step.optional && step.state !== "restricted")),
    savedAnswers: plainAnswers(answers, corp),
  };
}
