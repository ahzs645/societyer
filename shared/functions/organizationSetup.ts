/**
 * PORTABLE FUNCTIONS: organization setup (`/app/organization-setup`).
 *
 * - `progress` gathers counts and booleans from the registers the viewer may
 *   read (probing each read permission the way the dashboard does) and runs
 *   the pure evaluator in shared/organizationSetup/evaluate.ts. No row data,
 *   names or ids from the registers leave the query.
 * - `decideStep` stores "Doesn't apply to us" (with a reason) or "Remind me
 *   later" for one step, or clears the decision.
 * - `markSubmitted` moves a preparing workspace to "submitted" (filed with the
 *   registry), or back with `undo`.
 * - `recordIncorporation` records the official certificate: it validates the
 *   uploaded certificate, marks the organization incorporated and active, and
 *   activates the home registration with the number and date.
 *
 * One implementation for hosted Convex and the local runtimes.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import { certificateAnniversaryDate, validateEntitySetup, validateFormationEvidence } from "../entitySetup";
import { validateWorkspaceLegalIdentity } from "../organizationDomain";
import { onboardingAnswerSentences, readOnboardingAnswersJson, type OrganizationOnboardingAnswers } from "../onboarding";
import { organizationToday } from "./electionElectorate";
import { isDateOnly, parseDateOnly } from "../dateOnly";
import {
  decidableSetupSteps,
  evaluateOrganizationSetup,
  type OrganizationSetupFacts,
  type SetupEvidenceStage,
  type SetupRoleCounts,
} from "../organizationSetup/evaluate";
import { SETUP_DECISION_REASON_MAX, isKnownSetupStepKey, type SetupOrganization } from "../organizationSetup/catalogue";
import type { OrganizationSetupProgress, SetupStepDecision, SetupStepKey } from "../organizationSetup/types";

const SETUP_READ_PERMISSIONS: readonly Permission[] = [
  "documents:read", "members:read", "directors:read", "users:read", "tasks:read",
  "deadlines:read", "meetings:read", "filings:read", "minutes:read", "settings:read",
];

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const REFERENCE_MAX = 120;
const NUMBER_MAX = 64;

async function setupReadAccess(ctx: PortableQueryCtx, societyId: string) {
  const user = await requirePermissionPortable(ctx, societyId, "society:read");
  const readable = await Promise.all(SETUP_READ_PERMISSIONS.map(async (permission) => {
    try { await requirePermissionPortable(ctx, societyId, permission); return permission; }
    catch (error) {
      if (error instanceof Error && /^(?:Permission|Service scope) [a-zA-Z]+:read required\.$/.test(error.message)) return null;
      throw error;
    }
  }));
  return { user, readable: new Set<string>(["society:read", ...readable.filter((permission): permission is Permission => permission !== null)]) };
}

/** Saved answers, or undefined when absent or no longer valid for the profile. */
function savedAnswers(society: Record<string, any>): OrganizationOnboardingAnswers | undefined {
  try { return readOnboardingAnswersJson(society.onboardingAnswersJson); } catch { return undefined; }
}

function setupOrganization(society: Record<string, any>): SetupOrganization {
  return {
    name: society.name, entityType: society.entityType, jurisdictionCode: society.jurisdictionCode,
    homeJurisdictionCode: society.homeJurisdictionCode, actFormedUnder: society.actFormedUnder, legalSubtype: society.legalSubtype,
    formationStatus: society.formationStatus, organizationStatus: society.organizationStatus,
    isMemberFunded: society.isMemberFunded, isCharity: society.isCharity, numbered: society.numbered,
    registeredOfficeAddress: society.registeredOfficeAddress, incorporationNumber: society.incorporationNumber,
    certificateDate: society.certificateDate, certificateEvidenceDocumentId: society.certificateEvidenceDocumentId ? String(society.certificateEvidenceDocumentId) : undefined,
    fiscalYearEnd: society.fiscalYearEnd, annualMeetingDate: society.annualMeetingDate,
    craBnStatus: society.craBnStatus, charityStatus: society.charityStatus,
    iscRegisterEntryDate: society.iscRegisterEntryDate, transparencyEntryDate: society.transparencyEntryDate,
    privacyProgramStatus: society.privacyProgramStatus,
    filingSubmittedAtISO: society.filingSubmittedAtISO, filingReference: society.filingReference,
    hasConstitutionDocument: Boolean(society.constitutionDocId),
    hasBylawsDocument: Boolean(society.bylawsDocId),
    hasPrivacyPolicyDocument: Boolean(society.privacyPolicyDocId),
  };
}

function storedDecisions(society: Record<string, any>): SetupStepDecision[] {
  return (Array.isArray(society.setupStepDecisions) ? society.setupStepDecisions : [])
    .filter((entry: any) => entry && isKnownSetupStepKey(String(entry.stepKey)) && ["not_applicable", "later"].includes(entry.decision))
    .map((entry: any) => ({
      stepKey: entry.stepKey as SetupStepKey, decision: entry.decision, decidedAtISO: String(entry.decidedAtISO ?? ""),
      ...(entry.reason ? { reason: String(entry.reason) } : {}),
    }));
}

const PACKET_RUN_MARKER = /^societyer:(?:corporation|society)-packet-run:(.+)$/;

export async function progressPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }): Promise<OrganizationSetupProgress | null> {
  const { readable } = await setupReadAccess(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  if (!society) return null;
  const can = (permission: Permission) => readable.has(permission);
  const bySociety = (table: string) => ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId));
  const none = Promise.resolve([] as any[]);
  const now = new Date();
  const nowISO = now.toISOString();
  const year = now.getFullYear();

  const [roleHolders, rightsClasses, transfers, holdings, nameSearches, formationRecords, precedentRuns, pathwayRuns, users, invitations, registrations, recordsLocations, members, directors, upcomingMeetings, meetingsThisYear, filings, openDeadlines, minuteBook] = await Promise.all([
    can("documents:read") ? bySociety("roleHolders").collect() : none,
    can("documents:read") ? bySociety("rightsClasses").collect() : none,
    can("documents:read") ? bySociety("rightsholdingTransfers").collect() : none,
    can("documents:read") ? bySociety("rightsHoldings").collect() : none,
    can("documents:read") ? bySociety("nameSearchItems").collect() : none,
    can("documents:read") ? bySociety("formationRecords").collect() : none,
    can("documents:read") ? bySociety("legalPrecedentRuns").collect() : none,
    can("tasks:read") ? bySociety("pathwayRuns").collect() : none,
    can("users:read") ? bySociety("users").collect() : none,
    can("users:read") ? bySociety("invitations").collect() : none,
    bySociety("organizationRegistrations").collect(),
    can("documents:read") ? bySociety("recordsLocation").collect() : none,
    can("members:read") ? ctx.db.query("members").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : none,
    can("directors:read") ? ctx.db.query("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect() : none,
    can("meetings:read") ? ctx.db.query("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", nowISO.slice(0, 10))).take(200) : none,
    can("meetings:read") ? ctx.db.query("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId).gte("scheduledAt", `${year}-01-01`).lt("scheduledAt", `${year + 1}-01-01`)).collect() : none,
    can("filings:read") ? bySociety("filings").take(1) : none,
    can("deadlines:read") ? ctx.db.query("deadlines").withIndex("by_society_done", (q) => q.eq("societyId", societyId).eq("done", false)).take(1) : none,
    can("minutes:read") ? bySociety("minuteBookItems").collect() : none,
  ]);

  // Role-holder registers keep their own authority: directors and officers
  // need directors:read, controllers need settings:read.
  const roleCounts = (roleType: string): SetupRoleCounts => {
    const visible = roleType === "controller" ? can("settings:read") : ["director", "officer"].includes(roleType) ? can("directors:read") : true;
    const rows = visible ? roleHolders.filter((row: any) => row.roleType === roleType) : [];
    return {
      current: rows.filter((row: any) => (row.status ?? "current") === "current").length,
      proposed: rows.filter((row: any) => row.status === "proposed").length,
    };
  };
  const activeClass = (row: any) => row.status !== "inactive";
  const generatedPackets = new Set<string>();
  for (const run of precedentRuns) {
    for (const id of run.sourceExternalIds ?? []) {
      const match = PACKET_RUN_MARKER.exec(String(id));
      if (match) generatedPackets.add(match[1]);
    }
  }
  let pathwayRun: OrganizationSetupFacts["pathwayRun"] = null;
  const latestRun = [...pathwayRuns].sort((a: any, b: any) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")))[0];
  if (latestRun) {
    const steps = await ctx.db.query("pathwaySteps").withIndex("by_run", (q) => q.eq("runId", latestRun._id)).collect();
    pathwayRun = { nodes: Object.fromEntries(steps.map((step: any) => [String(step.nodeKey), String(step.state)])) };
  }
  const evidence: Record<string, SetupEvidenceStage> = {};
  if (can("deadlines:read")) {
    for (const entry of society.postIncorporationEvidence ?? []) {
      if (["preparing", "executed", "filed", "certified"].includes(entry?.stage)) evidence[String(entry.stepKey)] = entry.stage;
    }
  }
  const answers = savedAnswers(society);
  const facts: OrganizationSetupFacts = {
    organization: setupOrganization(society),
    answers,
    roles: { director: roleCounts("director"), officer: roleCounts("officer"), shareholder: roleCounts("shareholder"), controller: roleCounts("controller") },
    societyDirectors: directors.length,
    members: members.length,
    shareClasses: rightsClasses.filter((row: any) => ["share", "voting", "non_voting"].includes(row.classType) && activeClass(row)).length,
    membershipClasses: rightsClasses.filter((row: any) => row.classType === "membership" && activeClass(row)).length,
    issuances: {
      posted: transfers.filter((row: any) => row.transferType === "issuance" && row.status === "posted").length,
      draft: transfers.filter((row: any) => row.transferType === "issuance" && row.status === "draft").length,
    },
    holdings: holdings.filter((row: any) => (row.status ?? "current") === "current" && Number(row.quantity) !== 0).length,
    nameApproved: nameSearches.some((row: any) => row.success === true) || formationRecords.some((row: any) => Boolean(String(row.nuansNumber ?? "").trim())),
    evidence,
    generatedPackets: [...generatedPackets],
    pathwayRun,
    users: can("users:read") ? users.filter((row: any) => !row.status || row.status === "Active" || row.status === "Invited").length : 1,
    pendingInvitations: invitations.filter((row: any) => !row.acceptedAtISO && !row.revokedAtISO && (!row.expiresAtISO || row.expiresAtISO > nowISO)).length,
    otherRegistrations: registrations.filter((row: any) => row.registrationType && row.registrationType !== "home" && row.registrationType !== "deregistered").length,
    recordsOffice: recordsLocations.some((row: any) => Boolean(String(row.address ?? "").trim())),
    upcomingAnnualMeeting: upcomingMeetings.some((row: any) => row.status !== "Cancelled" && /agm|annual/i.test(`${row.type ?? ""} ${row.title ?? ""}`)),
    meetingsThisYear: meetingsThisYear.length,
    filingsTracked: filings.length > 0,
    openDeadlines: openDeadlines.length,
    minuteBookItems: minuteBook.filter((row: any) => !row.archivedAtISO).length,
  };
  const result = evaluateOrganizationSetup(facts, storedDecisions(society), readable);
  const sentences = onboardingAnswerSentences(answers, society as any);
  return sentences.length ? { ...result, savedAnswers: sentences } : result;
}

async function actorName(ctx: PortableQueryCtx, user: Record<string, any>) {
  return String(user.displayName ?? "").trim() || (ctx.principal.kind === "service" ? "Service" : "You");
}

async function logSetupActivity(ctx: PortableMutationCtx, societyId: string, actor: string, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId, actor, entityType: "society", subjectId: societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: societyId,
    action, summary: summary.slice(0, 300), createdAtISO: new Date().toISOString(),
  });
}

function cleanText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  if (CONTROL_CHARACTERS.test(trimmed)) throw new Error(`${label} contains characters that can't be saved.`);
  return trimmed;
}

function requireDate(value: unknown, label: string): string {
  if (!isDateOnly(value) || !parseDateOnly(value)) throw new Error(`${label} must be a valid date (YYYY-MM-DD).`);
  return value;
}

export async function decideStepPortable(ctx: PortableMutationCtx, args: {
  societyId: string; stepKey: string; decision: "not_applicable" | "later" | null; reason?: string;
}) {
  const user = await requirePermissionPortable(ctx, args.societyId, "society:write");
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const steps = decidableSetupSteps(setupOrganization(society), savedAnswers(society));
  const definition = isKnownSetupStepKey(args.stepKey) ? steps.get(args.stepKey) : undefined;
  if (!definition) throw new Error("This setup step doesn't apply to this organization.");
  if (args.decision !== null && args.decision !== "not_applicable" && args.decision !== "later") throw new Error("Choose a supported decision.");
  const reason = cleanText(args.reason, "Reason", SETUP_DECISION_REASON_MAX);
  if (args.decision === "not_applicable") {
    if (!definition.allowNotApplicable) throw new Error("This step can't be marked as not applying.");
    if (!reason) throw new Error("Say why this step doesn't apply.");
  }
  if (args.decision === "later" && definition.lifecycle) throw new Error("This step can't be put off. Undo the filing or record the certificate instead.");
  const others = (Array.isArray(society.setupStepDecisions) ? society.setupStepDecisions : []).filter((entry: any) => entry?.stepKey !== args.stepKey);
  const decidedByUserId = user._id ? String(user._id) : undefined;
  const next = args.decision === null ? others : [...others, {
    stepKey: definition.key, decision: args.decision,
    ...(args.decision === "not_applicable" && reason ? { reason } : {}),
    decidedAtISO: new Date().toISOString(),
    ...(decidedByUserId ? { decidedByUserId } : {}),
  }];
  await ctx.db.patch(args.societyId, { setupStepDecisions: next, updatedAt: Date.now() });
  const summary = args.decision === "not_applicable" ? `Setup: "${definition.title}" marked as not applying (${reason})`
    : args.decision === "later" ? `Setup: "${definition.title}" put off for later`
    : `Setup: "${definition.title}" back on the list`;
  await logSetupActivity(ctx, args.societyId, await actorName(ctx, user), "setup_step_decided", summary);
  return definition.key;
}

export async function markSubmittedPortable(ctx: PortableMutationCtx, args: {
  societyId: string; submittedOn?: string; reference?: string; undo?: boolean;
}) {
  const user = await requirePermissionPortable(ctx, args.societyId, "society:write");
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const status = String(society.formationStatus ?? "");
  const actor = await actorName(ctx, user);
  if (args.undo) {
    if (status !== "submitted") throw new Error("Only a filing marked as submitted can be undone.");
    await ctx.db.patch(args.societyId, { formationStatus: "preparing", filingSubmittedAtISO: undefined, filingReference: undefined, updatedAt: Date.now() });
    await logSetupActivity(ctx, args.societyId, actor, "filing_unmarked", "Setup: incorporation filing marked as not filed yet");
    return "preparing";
  }
  if (status !== "preparing") throw new Error(status === "submitted" ? "The filing is already marked as submitted." : "Only an organization preparing to incorporate can be marked as filed.");
  const today = organizationToday(society);
  const submittedOn = args.submittedOn === undefined || args.submittedOn === "" ? today : requireDate(args.submittedOn, "Filing date");
  if (submittedOn > today) throw new Error("The filing date can't be in the future.");
  const reference = cleanText(args.reference, "Reference", REFERENCE_MAX);
  await ctx.db.patch(args.societyId, { formationStatus: "submitted", filingSubmittedAtISO: submittedOn, filingReference: reference, updatedAt: Date.now() });
  await logSetupActivity(ctx, args.societyId, actor, "filing_submitted", `Setup: incorporation filed on ${submittedOn}${reference ? ` (reference ${reference})` : ""}`);
  return "submitted";
}

export async function recordIncorporationPortable(ctx: PortableMutationCtx, args: {
  societyId: string; certificateDocumentId: string; certificateReference?: string; certificateDate: string; incorporationNumber: string;
}) {
  const user = await requirePermissionPortable(ctx, args.societyId, "society:write");
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const incorporationNumber = cleanText(args.incorporationNumber, "Incorporation number", NUMBER_MAX);
  if (!incorporationNumber) throw new Error("Enter the number shown on the certificate.");
  const certificateDate = requireDate(args.certificateDate, "Certificate date");
  if (certificateDate > organizationToday(society)) throw new Error("The certificate date can't be in the future.");
  const certificateReference = cleanText(args.certificateReference, "Certificate reference", REFERENCE_MAX) ?? incorporationNumber;
  const document = await getOwned(ctx, "documents", args.certificateDocumentId, args.societyId);
  const versions = await ctx.db.query("documentVersions").withIndex("by_document", (q) => q.eq("documentId", document._id)).collect();
  const formation = { ...society, formationStatus: "incorporated", certificateEvidenceDocumentId: args.certificateDocumentId, certificateReference, certificateDate };
  validateEntitySetup(formation);
  validateFormationEvidence(formation, args.societyId, document, versions);
  const keepStatus = ["archived", "removed"].includes(String(society.organizationStatus ?? ""));
  const patch = {
    formationStatus: "incorporated",
    certificateEvidenceDocumentId: args.certificateDocumentId,
    certificateReference,
    certificateDate,
    incorporationNumber,
    incorporationDate: certificateDate,
    anniversaryDate: certificateAnniversaryDate(society, formation),
    organizationStatus: keepStatus ? society.organizationStatus : "active",
    updatedAt: Date.now(),
  };
  validateWorkspaceLegalIdentity({ ...society, ...patch });

  // The home registration becomes active with the registry number and date.
  const nowISO = new Date().toISOString();
  const primary = society.primaryRegistrationId ? await ctx.db.get(String(society.primaryRegistrationId), "organizationRegistrations") : null;
  const home = primary && primary.societyId === args.societyId
    ? primary
    : (await ctx.db.query("organizationRegistrations").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect())
      .find((row: any) => row.registrationType === "home") ?? null;
  const registration = { status: "active", registrationNumber: incorporationNumber, registrationDate: certificateDate, updatedAtISO: nowISO };
  let primaryRegistrationId = home?._id ? String(home._id) : undefined;
  if (home) {
    await ctx.db.patch(String(home._id), { ...registration, ...(home.status === "pending" ? { notes: "Created automatically from the workspace home jurisdiction." } : {}) });
  } else {
    const jurisdiction = society.homeJurisdictionCode ?? society.jurisdictionCode;
    if (jurisdiction) {
      primaryRegistrationId = await ctx.db.insert("organizationRegistrations", {
        societyId: args.societyId, registrationType: "home", jurisdiction, homeJurisdiction: jurisdiction,
        representativeIds: [], notes: "Created automatically from the workspace home jurisdiction.", createdAtISO: nowISO, ...registration,
      });
    }
  }
  await ctx.db.patch(args.societyId, { ...patch, ...(primaryRegistrationId && !society.primaryRegistrationId ? { primaryRegistrationId } : {}) });
  await logSetupActivity(ctx, args.societyId, await actorName(ctx, user), "incorporation_recorded", `Setup: certificate of incorporation recorded (${incorporationNumber}, ${certificateDate})`);
  return "incorporated";
}
