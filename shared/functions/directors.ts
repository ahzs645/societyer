import {createContact, addEvent, observe, reviewMatch} from "./personHistory";
import {exactDay,requireEvidence} from "../evidenceReview";
/**
 * PORTABLE FUNCTIONS: the directors domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { assertValid, directorProblems } from "../registerValidation";
import { todayDateOnly } from "../dateOnly";
import { requirePermissionPortable } from "./permissions";
import { directorConsentAssessments } from "./businessEvidence";
import { consentStateSatisfied, type DirectorConsentState } from "../directorConsentRecords";

export interface DirectorCreateArgs {
  societyId: string;
  memberId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  aliases?: string[];
  position: string;
  isBCResident: boolean;
  residentCanadianStatus?: "yes" | "no" | "unknown";
  residentCanadianEvidence?: string;
  termStart: string;
  termEnd?: string;
  /**
   * Ignored: consent to act is recorded in the consent register
   * (`directorConsents`), never asserted by creating a director. Kept so
   * older clients that still send it are accepted.
   */
  consentOnFile?: boolean;
  status: string;
  notes?: string;
}

export interface DirectorPatch {
  positionChangeEvidence?: {effectiveDate:string;sourceUrl:string;sourceReference:string;reviewStatus:string};
  firstName?: string;
  lastName?: string;
  memberId?: string;
  email?: string;
  aliases?: string[];
  position?: string;
  isBCResident?: boolean;
  residentCanadianStatus?: "yes" | "no" | "unknown";
  residentCanadianEvidence?: string;
  termStart?: string;
  termEnd?: string;
  /**
   * Not a way to assert consent. `true` is ignored; `false` (the drawer's
   * "Clear flag" for a pre-register mark) resets the flag to what the consent
   * register supports, which is false unless a verified consent is current.
   */
  consentOnFile?: boolean;
  resignedAt?: string;
  status?: string;
  notes?: string;
}

export async function directorsList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("directors")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function directorCreate(ctx: PortableMutationCtx, args: DirectorCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
  assertValid(directorProblems(args), "Director");
  // A new director has no consent on file until the consent register verifies one.
  return ctx.db.insert("directors", { ...args, consentOnFile: false, firstName: args.firstName.trim(), lastName: args.lastName.trim(), email: args.email?.trim() || undefined });
}

/**
 * Each director's consent evidence state, derived from the consent register on
 * the organization's today (shared/directorConsentRecords.ts). Reads every
 * register entry, including ones citing documents the reader can't open; only
 * the state and entry ids are returned.
 */
export interface DirectorConsentStateRow {
  directorId: string;
  state: DirectorConsentState;
  currentId?: string;
  upcomingId?: string;
  upcomingEffectiveDate?: string;
  basisNotAccepted?: boolean;
  basisNotAcceptedReason?: string;
}

export async function directorConsentStates(ctx: PortableQueryCtx, { societyId }: { societyId: string }): Promise<DirectorConsentStateRow[]> {
  await requirePermissionPortable(ctx, societyId, "directors:read");
  const directors = await ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const assessments = await directorConsentAssessments(ctx, societyId, directors.map((row) => ({ _id: String(row._id), consentOnFile: Boolean(row.consentOnFile) })));
  return directors.map((row) => {
    const assessment = assessments.get(String(row._id));
    const out: DirectorConsentStateRow = { directorId: String(row._id), state: assessment?.state ?? "none" };
    if (assessment?.current) out.currentId = assessment.current._id;
    if (assessment?.upcoming) {
      out.upcomingId = assessment.upcoming._id;
      out.upcomingEffectiveDate = assessment.upcoming.effectiveDate;
    }
    if (assessment?.basisNotAccepted) out.basisNotAccepted = true;
    if (assessment?.basisNotAcceptedReason) out.basisNotAcceptedReason = assessment.basisNotAcceptedReason;
    return out;
  });
}

export async function directorUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: DirectorPatch }): Promise<void> {
  const authorizedRow = await requireOwnedRow(ctx, "directors", id);
  const societyId = String(authorizedRow.societyId);
  if (patch.memberId){const member=await getOwned(ctx,"members",patch.memberId,societyId);if(authorizedRow.directoryPersonId&&member.directoryPersonId&&authorizedRow.directoryPersonId!==member.directoryPersonId)throw new Error("The selected member has a different confirmed person identity.");}
  // Consent to act can't be asserted by editing the director: the flag follows
  // the consent register. Clearing it resets it to what the register supports.
  const {positionChangeEvidence,consentOnFile:requestedConsent,...edits}=patch;
  const values: Omit<DirectorPatch,"positionChangeEvidence"> = { ...edits };
  if (requestedConsent === false) {
    const assessment = (await directorConsentAssessments(ctx, societyId, [{ _id: id, consentOnFile: false }])).get(id);
    values.consentOnFile = consentStateSatisfied(assessment?.state);
  }
  assertValid(directorProblems({ ...authorizedRow, ...values }), "Director");
  if(patch.position!==undefined&&patch.position!==authorizedRow.position){
    if(!positionChangeEvidence||!exactDay(positionChangeEvidence.effectiveDate))throw new Error("Record the effective day and source evidence for a position change.");
    requireEvidence(positionChangeEvidence);
    if(positionChangeEvidence.reviewStatus!=="verified")throw new Error("Review position-change evidence before changing the current register.");
    if(positionChangeEvidence.effectiveDate>todayDateOnly())throw new Error("Record a future appointment in history; the current register changes when it takes effect.");
    const linkedMember=authorizedRow.memberId?await getOwned(ctx,"members",authorizedRow.memberId,societyId):null;
    const personId=authorizedRow.directoryPersonId??linkedMember?.directoryPersonId??await createContact(ctx,{societyId,fullName:`${authorizedRow.firstName} ${authorizedRow.lastName}`.trim(),sourceKey:`director:${id}`});
    const source={sourceUrl:positionChangeEvidence.sourceUrl,sourceReference:positionChangeEvidence.sourceReference,reviewStatus:'verified'};
    if(!authorizedRow.directoryPersonId){
      const existingOccurrences=await ctx.db.query('personOccurrences').withIndex('by_record',q=>q.eq('societyId',societyId).eq('recordTable','directors').eq('recordId',id)).collect();
      const occurrenceId=existingOccurrences[0]?._id??await observe(ctx,{societyId,observation:{occurrenceKey:`register:directors:${id}`,recordTable:'directors',recordId:id,personName:`${authorizedRow.firstName} ${authorizedRow.lastName}`,context:'Director register identity',observedDate:positionChangeEvidence.effectiveDate,...source}});
      await reviewMatch(ctx,{societyId,occurrenceId,personId,status:'verified',rationale:'Director selected deliberately for the cited position-change record.',source});
    }
    const scope=`director:${id}`;
    const events=await ctx.db.query('personHistoryEvents').withIndex('by_person',q=>q.eq('societyId',societyId).eq('personId',personId)).collect();
    const preceding=events.filter(e=>e.kind==='role'&&e.scope===scope&&e.reviewStatus==='verified').sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate))[0];
    await addEvent(ctx,{societyId,personId,event:{eventKey:`director:${id}:previous:${positionChangeEvidence.effectiveDate}:${authorizedRow.position}`,kind:'observation',scope,title:`Prior register position: ${authorizedRow.position}`,value:authorizedRow.position,effectiveDate:positionChangeEvidence.effectiveDate,transition:'observed',details:'Preserved before this edit. The previous position start and end dates require evidence. Prior register snapshot: '+JSON.stringify(authorizedRow),...source,reviewStatus:'pending'}});
    await addEvent(ctx,{societyId,personId,event:{eventKey:`director:${id}:role:${positionChangeEvidence.effectiveDate}:${patch.position}`,kind:'role',scope,title:`Position changed to ${patch.position}`,value:patch.position,effectiveDate:positionChangeEvidence.effectiveDate,transition:'changed',...(preceding?{supersedesEventId:preceding._id}:{}),...source}});
  }
  await ctx.db.patch(id, values);
}

export async function directorRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await requireOwnedRow(ctx, "directors", id);
  await ctx.db.delete(id);
}
