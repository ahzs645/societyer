/**
 * The pure organization setup evaluator.
 *
 * `evaluateOrganizationSetup(facts, decisions, readable)` turns counts and
 * booleans about one organization into `OrganizationSetupProgress`: the
 * variant, the current phase, every step's state, the next recommended step
 * and the counts. Completion is computed from records, never ticked; the only
 * manual states are the stored "Doesn't apply to us" and "Remind me later"
 * decisions.
 *
 * Rules (see the design in the setup IA review, §3):
 * - Current phase: preparing → "prepare", or "file" once every required
 *   prepare step is done or decided; submitted → "file" (waiting for the
 *   registry); incorporated → "organize", then "maintain" once organize is
 *   done; existing organizations → the first phase with an open required step.
 * - Counts cover prepare..organize and only required steps; a
 *   "Doesn't apply" step leaves the total, a "later" step stays in it.
 * - Next step: in the current phase, the first required step that is not done,
 *   not decided and readable by this viewer; otherwise the first such step in
 *   a later phase. Optional steps are never recommended.
 * - A step is "restricted" when the viewer lacks one of its read permissions
 *   (destination page or the registers its rule reads) and it isn't done.
 */

import { formatLongDate } from "../locale";
import type { OrganizationOnboardingAnswers } from "../onboarding";
import {
  SETUP_PHASE_ORDER,
  setupCopyContext,
  setupPhases,
  setupStepCatalogue,
  setupVariant,
  setupWaitingNote,
  type SetupCopyContext,
  type SetupOrganization,
  type SetupStepDefinition,
} from "./catalogue";
import type {
  OrganizationSetupProgress,
  SetupPhaseKey,
  SetupPhaseView,
  SetupStepDecision,
  SetupStepKey,
  SetupStepState,
  SetupStepView,
  SetupVariant,
} from "./types";

export { setupVariant };

export type SetupRoleCounts = { current: number; proposed: number };
export type SetupEvidenceStage = "preparing" | "executed" | "filed" | "certified";

/**
 * Counts and booleans only: the progress query never returns row data. A
 * source the viewer can't read is reported as zero/false (and the steps that
 * depend on it show as restricted).
 */
export type OrganizationSetupFacts = {
  organization: SetupOrganization;
  answers?: OrganizationOnboardingAnswers | null;
  /** Structured role holders (corporations and other non-society organizations). */
  roles: { director: SetupRoleCounts; officer: SetupRoleCounts; shareholder: SetupRoleCounts; controller: SetupRoleCounts };
  /** Society `directors` and `members` tables (active rows). */
  societyDirectors: number;
  members: number;
  /** Active or proposed share / voting / non-voting classes. */
  shareClasses: number;
  /** Active or proposed membership classes. */
  membershipClasses: number;
  issuances: { posted: number; draft: number };
  /** Current holdings in the share register. */
  holdings: number;
  /** A successful name search or a recorded NUANS report. */
  nameApproved: boolean;
  /** Post-incorporation evidence stage by checklist step key. */
  evidence: Record<string, SetupEvidenceStage>;
  /** Document packets with a staged precedent run. */
  generatedPackets: string[];
  /** Node states of the latest formal preparation run, when one exists. */
  pathwayRun?: { nodes: Record<string, string> } | null;
  users: number;
  pendingInvitations: number;
  /** Registrations other than the home one (extra-provincial and similar). */
  otherRegistrations: number;
  recordsOffice: boolean;
  upcomingAnnualMeeting: boolean;
  meetingsThisYear: number;
  filingsTracked: boolean;
  openDeadlines: number;
  minuteBookItems: number;
};

/** Which read permissions the viewer has (a set or a predicate). Omitted = everything readable. */
export type SetupReadable = ReadonlySet<string> | ((permission: string) => boolean);

const EVIDENCE_RANK: Record<string, number> = { preparing: 0, executed: 1, filed: 2, certified: 3 };

/** Empty facts for an organization (tests and callers fill in what they know). */
export function emptyOrganizationSetupFacts(organization: SetupOrganization, answers?: OrganizationOnboardingAnswers | null): OrganizationSetupFacts {
  const none = () => ({ current: 0, proposed: 0 });
  return {
    organization, answers,
    roles: { director: none(), officer: none(), shareholder: none(), controller: none() },
    societyDirectors: 0, members: 0, shareClasses: 0, membershipClasses: 0,
    issuances: { posted: 0, draft: 0 }, holdings: 0, nameApproved: false,
    evidence: {}, generatedPackets: [], pathwayRun: null,
    users: 1, pendingInvitations: 0, otherRegistrations: 0, recordsOffice: false,
    upcomingAnnualMeeting: false, meetingsThisYear: 0, filingsTracked: false, openDeadlines: 0, minuteBookItems: 0,
  };
}

type Status = { state: "done" | "in_progress" | "todo"; note?: string };
const done = (note?: string): Status => ({ state: "done", ...(note ? { note } : {}) });
const progress = (note?: string): Status => ({ state: "in_progress", ...(note ? { note } : {}) });
const todo = (): Status => ({ state: "todo" });

function either(condition: boolean, partial: boolean, notes: { done?: string; partial?: string } = {}): Status {
  if (condition) return done(notes.done);
  return partial ? progress(notes.partial) : todo();
}

function evidenceAtLeast(facts: OrganizationSetupFacts, keys: string[], stage: SetupEvidenceStage): boolean {
  return keys.some((key) => facts.evidence[key] !== undefined && EVIDENCE_RANK[facts.evidence[key]] >= EVIDENCE_RANK[stage]);
}

function packetGenerated(facts: OrganizationSetupFacts, keys: string[]): boolean {
  return keys.some((key) => facts.generatedPackets.includes(key));
}

function pathwayNode(facts: OrganizationSetupFacts, node: string, states: string[]): boolean {
  const state = facts.pathwayRun?.nodes?.[node];
  return state !== undefined && states.includes(state);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const COMPLETED_NODE = ["completed", "approved", "submitted", "skipped"];

/** Completion rule for one step (before decisions and permissions). */
function stepStatus(definition: SetupStepDefinition, variant: SetupVariant, facts: OrganizationSetupFacts, ctx: SetupCopyContext): Status {
  const org = facts.organization;
  const roles = facts.roles;
  const formation = String(org.formationStatus ?? "");
  const filed = formation === "submitted" || formation === "incorporated";
  const incorporated = formation === "incorporated";
  const anyRole = (counts: SetupRoleCounts) => counts.current + counts.proposed;
  switch (definition.key) {
    case "act":
      return org.jurisdictionCode && org.actFormedUnder ? done(ctx.placeName ? `${ctx.placeName} · ${ctx.actTitle}` : ctx.actTitle) : todo();
    case "name": {
      if (!ctx.society && org.numbered) return done("Numbered name");
      if (facts.nameApproved || pathwayNode(facts, "name-approval", COMPLETED_NODE) || pathwayNode(facts, "numbered-name", COMPLETED_NODE)) return done(org.name ? `Name: ${org.name}` : undefined);
      return progress(org.name ? `Working name saved: ${org.name}` : undefined);
    }
    case "office":
      return org.registeredOfficeAddress?.trim() ? done() : todo();
    case "records-office":
      return facts.recordsOffice ? done() : todo();
    case "directors": {
      if (variant === "existing") {
        const count = ctx.society ? facts.societyDirectors : roles.director.current;
        return count > 0 ? done(plural(count, "director", "directors")) : todo();
      }
      if (ctx.society) {
        const needed = ctx.bcSociety && !ctx.memberFunded ? 3 : 1;
        const count = facts.societyDirectors;
        if (count >= needed) return done(plural(count, "director", "directors"));
        return count > 0 ? progress(`${count} of ${needed} added`) : todo();
      }
      const count = anyRole(roles.director);
      return count > 0 ? done(plural(count, "director", "directors")) : todo();
    }
    case "shares": {
      if (variant === "existing") {
        return either(facts.shareClasses > 0 && facts.holdings > 0, facts.shareClasses > 0 || facts.holdings > 0);
      }
      const classes = ctx.shareBased ? facts.shareClasses : facts.membershipClasses;
      if (classes > 0) return done(plural(classes, "class", "classes"));
      return ctx.classDetails ? progress(`Notes from setup: ${truncate(ctx.classDetails)}`) : todo();
    }
    case "isc":
      return anyRole(roles.controller) > 0 ? done(plural(anyRole(roles.controller), "person", "people")) : todo();
    case "articles": {
      const evidenceKeys = ctx.bcCompany ? ["bc-incorporation-agreement-articles", "bc-prepare-articles"] : ["prepare-federal-articles"];
      const packets = ctx.bcCompany ? ["bc-incorporation-agreement", "bc-articles-preparation"] : ["federal-articles-preparation"];
      // Articles on the profile (uploaded, re-filed or chosen there) are prepared.
      if (org.hasConstitutionDocument) return done("Articles on file");
      if (evidenceAtLeast(facts, evidenceKeys, "preparing") || pathwayNode(facts, "prepare-documents", COMPLETED_NODE)) return done();
      return packetGenerated(facts, packets) ? progress("Worksheet started") : todo();
    }
    case "review":
      if (pathwayNode(facts, "review", ["approved", "submitted", "completed"])) return done("Reviewed");
      return facts.pathwayRun ? progress("Review started") : todo();
    case "constitution":
      if (org.hasConstitutionDocument || evidenceAtLeast(facts, ["society-constitution-bylaws"], "preparing")) return done();
      return packetGenerated(facts, ["society-incorporation-constitution"]) ? progress("Draft started") : todo();
    case "bylaws":
      if (org.hasBylawsDocument || evidenceAtLeast(facts, ["society-prepare-bylaws"], "preparing")) return done();
      return packetGenerated(facts, ["society-incorporation-bylaws"]) ? progress("Draft started") : todo();
    case "file": {
      if (!filed) return todo();
      const parts = [org.filingSubmittedAtISO ? `Filed on ${org.filingSubmittedAtISO}` : "Filed", org.filingReference ? `Reference ${org.filingReference}` : ""].filter(Boolean);
      return done(parts.join(" · "));
    }
    case "certificate":
      if (incorporated) return done(org.certificateDate ? `Incorporated on ${formatLongDate(org.certificateDate)}` : undefined);
      return org.certificateEvidenceDocumentId ? progress("Certificate uploaded") : todo();
    case "organize": {
      const keys = ctx.bcCompany ? ["bc-organize-records"] : ["hold-organizational-meeting", "make-bylaws"];
      if (evidenceAtLeast(facts, keys, "executed")) return done();
      return evidenceAtLeast(facts, keys, "preparing") || packetGenerated(facts, ["organize-corporation"]) ? progress("Resolutions started") : todo();
    }
    case "officers": {
      if (roles.officer.current > 0) return done(plural(roles.officer.current, "officer", "officers"));
      return variant !== "existing" && roles.officer.proposed > 0 ? progress("Proposed officers saved") : todo();
    }
    case "issue-shares":
      return either(facts.issuances.posted > 0, facts.issuances.draft > 0, { partial: "Draft issue saved" });
    case "registers": {
      const evidence = evidenceAtLeast(facts, ctx.bcCompany ? ["bc-organize-records"] : ["set-up-minute-book"], "executed");
      const directors = roles.director.current > 0;
      const owners = ctx.shareBased ? roles.shareholder.current > 0 && facts.holdings > 0 : facts.members > 0;
      if (evidence || (directors && owners)) return done();
      return directors || owners || facts.minuteBookItems > 0 ? progress() : todo();
    }
    case "isc-register": {
      const entryDate = ctx.controlRegister === "transparency" ? org.transparencyEntryDate : org.iscRegisterEntryDate;
      if (roles.controller.current > 0 || entryDate) return done();
      return roles.controller.proposed > 0 ? progress("Only proposed entries so far") : todo();
    }
    case "business-number":
      if (org.craBnStatus === "confirmed" || org.craBnStatus === "not_required") return done();
      return org.craBnStatus === "pending" ? progress("Waiting for the number") : todo();
    case "provinces":
      return facts.otherRegistrations > 0 ? done(plural(facts.otherRegistrations, "registration", "registrations")) : todo();
    case "access":
      return facts.users > 1 || facts.pendingInvitations > 0 ? done() : todo();
    case "members":
      return facts.members > 0 ? done(plural(facts.members, "member", "members")) : todo();
    case "first-meeting":
      if (evidenceAtLeast(facts, ["society-records"], "executed")) return done();
      return evidenceAtLeast(facts, ["society-records"], "preparing") || packetGenerated(facts, ["society-directors-resolution"]) ? progress("Resolution started") : todo();
    case "tax": {
      const known = (value?: string | null) => Boolean(value) && value !== "unknown";
      return either(known(org.craBnStatus) && known(org.charityStatus), known(org.craBnStatus) || known(org.charityStatus));
    }
    case "number":
      return org.incorporationNumber?.trim() ? done(org.incorporationNumber.trim()) : todo();
    case "owners": {
      if (ctx.shareBased) {
        const count = roles.shareholder.current;
        return count > 0 || facts.holdings > 0 ? done(count ? plural(count, "shareholder", "shareholders") : undefined) : todo();
      }
      return facts.members > 0 ? done(plural(facts.members, "member", "members")) : todo();
    }
    case "governing-docs": {
      if (ctx.society) return either(Boolean(org.hasConstitutionDocument && org.hasBylawsDocument), Boolean(org.hasConstitutionDocument || org.hasBylawsDocument));
      return org.hasConstitutionDocument ? done() : todo();
    }
    case "minute-book":
      return facts.minuteBookItems > 0 ? done(plural(facts.minuteBookItems, "record", "records")) : todo();
    case "fiscal-year":
      return org.fiscalYearEnd ? done(`Year-end ${org.fiscalYearEnd}`) : todo();
    case "annual-meeting":
    case "agm":
      return facts.upcomingAnnualMeeting || org.annualMeetingDate ? done() : todo();
    case "calendar":
      return facts.filingsTracked || facts.openDeadlines > 0 ? done() : todo();
    case "privacy":
      return org.hasPrivacyPolicyDocument || org.privacyProgramStatus === "Ready" ? done() : todo();
    case "meetings":
      return facts.meetingsThisYear > 0 ? done(plural(facts.meetingsThisYear, "meeting this year", "meetings this year")) : todo();
    case "filings":
      return facts.filingsTracked ? done() : todo();
    default:
      return todo();
  }
}

function canRead(readable: SetupReadable | undefined, permission: string): boolean {
  if (!readable) return true;
  return typeof readable === "function" ? readable(permission) : readable.has(permission);
}

/** Only the latest valid decision per step counts, and only where the catalogue allows it. */
function decisionFor(definition: SetupStepDefinition, decisions: readonly SetupStepDecision[]): SetupStepDecision | undefined {
  const matches = decisions.filter((decision) => decision.stepKey === definition.key);
  const decision = matches[matches.length - 1];
  if (!decision) return undefined;
  if (decision.decision === "not_applicable" && definition.allowNotApplicable && decision.reason?.trim()) return decision;
  if (decision.decision === "later" && !definition.lifecycle) return decision;
  return undefined;
}

type EvaluatedStep = SetupStepView & { underlying: Status["state"]; decided: boolean };

/** Is a step open for the phase rule (required, not done, not decided)? */
function openForPhase(step: EvaluatedStep): boolean {
  return !step.optional && step.underlying !== "done" && !step.decided;
}

function currentPhaseFor(variant: SetupVariant, formationStatus: string, steps: EvaluatedStep[]): SetupPhaseKey {
  const openIn = (phase: SetupPhaseKey) => steps.some((step) => step.phase === phase && openForPhase(step));
  if (variant === "existing") return (["prepare", "file", "organize"] as SetupPhaseKey[]).find(openIn) ?? "maintain";
  if (formationStatus === "submitted") return "file";
  if (formationStatus === "incorporated") return openIn("organize") ? "organize" : "maintain";
  return openIn("prepare") ? "prepare" : "file";
}

/**
 * Evaluate setup for one organization and viewer.
 *
 * @param facts      counts and booleans gathered by the progress query
 * @param decisions  stored skip decisions (`societies.setupStepDecisions`)
 * @param readable   the viewer's read permissions; omitted = all readable
 */
export function evaluateOrganizationSetup(
  facts: OrganizationSetupFacts,
  decisions: readonly SetupStepDecision[] = [],
  readable?: SetupReadable,
): OrganizationSetupProgress {
  const variant = setupVariant(facts.organization, facts.answers);
  const ctx = setupCopyContext(facts.organization, facts.answers);
  const formationStatus = String(facts.organization.formationStatus ?? "");
  const catalogue = setupStepCatalogue(variant, ctx);

  const evaluated: EvaluatedStep[] = catalogue.map((definition) => {
    const status = stepStatus(definition, variant, facts, ctx);
    const decision = status.state === "done" ? undefined : decisionFor(definition, decisions);
    const restricted = status.state !== "done" && definition.readPermissions.some((permission) => !canRead(readable, permission));
    let state: SetupStepState = status.state;
    let note = status.note;
    if (decision?.decision === "not_applicable") { state = "not_applicable"; note = decision.reason?.trim(); }
    else if (restricted) { state = "restricted"; note = "Ask an owner or admin to do this"; }
    else if (decision?.decision === "later") state = "later";
    const view: EvaluatedStep = {
      key: definition.key,
      phase: definition.phase,
      title: definition.title,
      description: definition.description,
      state,
      ...(note ? { note } : {}),
      optional: definition.optional,
      allowNotApplicable: definition.allowNotApplicable,
      ...(definition.to ? { to: definition.to } : {}),
      ...(definition.actionLabel ? { actionLabel: definition.actionLabel } : {}),
      ...(definition.action ? { action: definition.action } : {}),
      ...(definition.externalUrl ? { externalUrl: definition.externalUrl } : {}),
      ...(definition.externalLabel ? { externalLabel: definition.externalLabel } : {}),
      underlying: status.state,
      decided: Boolean(decision),
    };
    return view;
  });

  const currentPhase = currentPhaseFor(variant, formationStatus, evaluated);
  const currentIndex = SETUP_PHASE_ORDER.indexOf(currentPhase);
  const counted = (step: EvaluatedStep) => step.phase !== "maintain" && !step.optional && step.state !== "not_applicable";
  const reachedMaintain = variant === "existing" || formationStatus === "incorporated";

  const phases: SetupPhaseView[] = setupPhases(variant, ctx).map((phase) => {
    const phaseSteps = evaluated.filter((step) => step.phase === phase.key);
    // "Remind me later" steps drop to the bottom of their phase.
    const ordered = [...phaseSteps.filter((step) => step.state !== "later"), ...phaseSteps.filter((step) => step.state === "later")];
    const scored = phaseSteps.filter((step) => !step.optional && step.state !== "not_applicable");
    const doneCount = scored.filter((step) => step.underlying === "done").length;
    const allDone = scored.length > 0 && doneCount === scored.length;
    const status: SetupPhaseView["status"] = phase.key === currentPhase ? "current"
      : phase.key === "maintain" ? (reachedMaintain ? "ongoing" : "upcoming")
      : allDone || (SETUP_PHASE_ORDER.indexOf(phase.key) < currentIndex && !scored.some(openForPhase)) ? "complete"
      : "upcoming";
    const waiting = phase.key === "file" && formationStatus === "submitted" && variant !== "existing";
    return {
      key: phase.key,
      title: phase.title,
      description: phase.description,
      done: doneCount,
      total: scored.length,
      status,
      ...(waiting ? { statusNote: setupWaitingNote(ctx) } : {}),
      steps: ordered.map(({ underlying: _underlying, decided: _decided, ...view }) => view),
    };
  });

  // Within a phase, a step nobody has started comes before one already under
  // way (e.g. a saved working name), so the recommendation moves forward.
  const searchOrder = SETUP_PHASE_ORDER.slice(currentIndex).filter((phase) => phase !== "maintain" || reachedMaintain || currentPhase === "maintain");
  let nextStep: EvaluatedStep | undefined;
  for (const phase of searchOrder) {
    const open = evaluated.filter((step) => step.phase === phase && !step.optional);
    nextStep = open.find((step) => step.state === "todo") ?? open.find((step) => step.state === "in_progress");
    if (nextStep) break;
  }

  const countedSteps = evaluated.filter(counted);
  const doneTotal = countedSteps.filter((step) => step.underlying === "done").length;
  return {
    variant,
    currentPhase,
    phases,
    ...(nextStep ? { next: { key: nextStep.key, title: nextStep.title, ...(nextStep.to ? { to: nextStep.to } : {}), ...(nextStep.action ? { action: nextStep.action } : {}) } } : {}),
    counts: { done: doneTotal, total: countedSteps.length },
    complete: doneTotal === countedSteps.length,
  };
}

/** Step keys a decision may target for this organization (validation for `decideStep`). */
export function decidableSetupSteps(organization: SetupOrganization, answers?: OrganizationOnboardingAnswers | null): Map<SetupStepKey, SetupStepDefinition> {
  const variant = setupVariant(organization, answers);
  const ctx = setupCopyContext(organization, answers);
  return new Map(setupStepCatalogue(variant, ctx).map((definition) => [definition.key, definition]));
}
