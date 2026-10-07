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

export interface DirectorCreateArgs {
  societyId: string;
  memberId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  aliases?: string[];
  position: string;
  isBCResident: boolean;
  termStart: string;
  termEnd?: string;
  consentOnFile: boolean;
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
  termStart?: string;
  termEnd?: string;
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
  return ctx.db.insert("directors", { ...args, firstName: args.firstName.trim(), lastName: args.lastName.trim(), email: args.email?.trim() || undefined });
}

export async function directorUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: DirectorPatch }): Promise<void> {
  const authorizedRow = await requireOwnedRow(ctx, "directors", id);
  const societyId = String(authorizedRow.societyId);
  if (patch.memberId){const member=await getOwned(ctx,"members",patch.memberId,societyId);if(authorizedRow.directoryPersonId&&member.directoryPersonId&&authorizedRow.directoryPersonId!==member.directoryPersonId)throw new Error("The selected member has a different confirmed person identity.");}
  const {positionChangeEvidence,...values}=patch;
  assertValid(directorProblems({ ...authorizedRow, ...values }), "Director");
  if(patch.position!==undefined&&patch.position!==authorizedRow.position){
    if(!positionChangeEvidence||!exactDay(positionChangeEvidence.effectiveDate))throw new Error("Record the effective day and source evidence for a position change.");
    requireEvidence(positionChangeEvidence);
    if(positionChangeEvidence.reviewStatus!=="verified")throw new Error("Review position-change evidence before changing the current register.");
    if(positionChangeEvidence.effectiveDate>new Date().toISOString().slice(0,10))throw new Error("Record a future appointment in history; the current register changes when it takes effect.");
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
