import type { PortableMutationCtx, PortableQueryCtx } from '../portable/ctx';
import { getOwned, requireOwnedRow, requireSocietyMembership } from './access';
import { requirePermissionPortable } from './permissions';
import { exactDay, partialDate, requireEvidence, uniqueRows } from '../evidenceReview';
export async function list(ctx:PortableQueryCtx,{societyId,memberId}:{societyId:string;memberId?:string}){
 await requireSocietyMembership(ctx,societyId);await requirePermissionPortable(ctx,societyId,'members:read');
 if(memberId)await getOwned(ctx,'members',memberId,societyId);
 const [seats,rules,assessments]=await Promise.all([
  ctx.db.query('organizationSeats').withIndex('by_society',q=>q.eq('societyId',societyId)).collect(),
  ctx.db.query('membershipRuleVersions').withIndex('by_society',q=>q.eq('societyId',societyId)).collect(),
  memberId?ctx.db.query('memberAssessments').withIndex('by_member',q=>q.eq('memberId',memberId)).collect():Promise.resolve([]),
 ]);return {seats,rules,assessments};
}
export async function observeSeat(ctx:PortableMutationCtx,args:{societyId:string;seatKey:string;organizationName:string;observation:any}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');const row=args.observation;requireEvidence(row);
 if(!row.id||!partialDate(row.startDate)||!partialDate(row.endDate)||!['representative','contact','staff','vacant','organization_member'].includes(row.kind))throw new Error('A seat observation needs an ID, a valid kind and source date precision.');
 if(row.startDate&&row.endDate&&exactDay(row.startDate)&&exactDay(row.endDate)&&row.endDate<row.startDate)throw new Error('The appointment interval is reversed.');
 if(!args.seatKey.trim()||!args.organizationName.trim())throw new Error('Organization and seat key are required.');
 const seats=await ctx.db.query('organizationSeats').withIndex('by_seat',q=>q.eq('societyId',args.societyId).eq('seatKey',args.seatKey.trim())).collect();
 const seat=seats[0];const old=(seat?.observations??[]).find((item:any)=>item.id===row.id);
 if(old){if(JSON.stringify(old)!==JSON.stringify(row))throw new Error('Seat observations are append-only.');return seat!._id;}
 if(seat){await ctx.db.patch(seat._id,{observations:[...seat.observations,row]});return seat._id;}
 return ctx.db.insert('organizationSeats',{societyId:args.societyId,seatKey:args.seatKey.trim(),organizationName:args.organizationName.trim(),observations:[row],createdAtISO:new Date().toISOString()});
}
export async function authorizeSeatProxy(ctx:PortableMutationCtx,args:{seatId:string;meetingId:string;principalName:string;proxyName:string;authority:any;source:any}){
 const seat=await requireOwnedRow(ctx,'organizationSeats',args.seatId);const societyId=String(seat.societyId);await requirePermissionPortable(ctx,societyId,'proxies:write');
 await getOwned(ctx,'meetings',args.meetingId,societyId);requireEvidence(args.authority);requireEvidence(args.source);
 if(args.authority.reviewStatus!=='verified'||args.source.reviewStatus!=='verified'||!args.principalName.trim()||!args.proxyName.trim())throw new Error('Proxy authority and appointment evidence must be verified for this meeting.');
 const existing=await ctx.db.query('seatProxyAuthorizations').withIndex('by_meeting',q=>q.eq('meetingId',args.meetingId)).collect();
 if(existing.some(row=>row.status==='authorized'&&(row.seatId===args.seatId||row.principalName.trim().toLocaleLowerCase()===args.principalName.trim().toLocaleLowerCase())))throw new Error('This principal already has a proxy authorization for the meeting. Count the principal once.');
 return ctx.db.insert('seatProxyAuthorizations',{...args,societyId,status:'authorized',createdAtISO:new Date().toISOString()});
}
export async function createRule(ctx:PortableMutationCtx,args:{societyId:string;ruleKey:string;effectiveDate:string;requirements:any[];authority:any;reviewStatus:string}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');requireEvidence(args.authority);uniqueRows(args.requirements);
 if(!exactDay(args.effectiveDate)||!args.ruleKey.trim()||!['pending','verified'].includes(args.reviewStatus)||!args.requirements.length)throw new Error('A rule version needs an effective day, review status and source requirements.');
 for(const row of args.requirements)if(!row.label||!['eligibility','orientation','renewal'].includes(row.category))throw new Error('Each rule requirement needs a label and category.');
 const rules=await ctx.db.query('membershipRuleVersions').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect();
 const version=Math.max(0,...rules.filter(row=>row.ruleKey===args.ruleKey).map(row=>row.version))+1;
 return ctx.db.insert('membershipRuleVersions',{...args,version,createdAtISO:new Date().toISOString()});
}
export async function assess(ctx:PortableMutationCtx,args:{memberId:string;ruleVersionId:string;asOf:string;results:any[]}){
 const member=await requireOwnedRow(ctx,'members',args.memberId);const societyId=String(member.societyId);await requirePermissionPortable(ctx,societyId,'members:write');
 const rule=await getOwned(ctx,'membershipRuleVersions',args.ruleVersionId,societyId);
 if(!exactDay(args.asOf)||rule.effectiveDate>args.asOf||rule.reviewStatus!=='verified')throw new Error('Select a verified rule version effective on the historical assessment day.');
 const required=rule.requirements;uniqueRows(args.results);
 if(args.results.some(row=>!required.some((item:any)=>item.id===row.id)))throw new Error('Assessment contains an unknown rule requirement.');
 const results=required.map((row:any)=>{const result=args.results.find(item=>item.id===row.id)??{id:row.id,state:'unknown'};if(!['met','not_met','unknown'].includes(result.state))throw new Error('Assessment results must be met, not met or unknown.');if(result.state!=='unknown')requireEvidence(result);return result;});
 const overall=results.some((row:any)=>row.state==='not_met')?'not_met':results.some((row:any)=>row.state==='unknown')?'unknown':'met';
 return ctx.db.insert('memberAssessments',{...args,societyId,results,overall,createdAtISO:new Date().toISOString()});
}
export async function transition(ctx:PortableMutationCtx,args:{memberId:string;assessmentId:string;status:string;votingRights?:boolean;source:any}){
 const member=await requireOwnedRow(ctx,'members',args.memberId);const societyId=String(member.societyId);await requirePermissionPortable(ctx,societyId,'members:write');requireEvidence(args.source);
 const assessment=await getOwned(ctx,'memberAssessments',args.assessmentId,societyId);
 if(assessment.memberId!==args.memberId||assessment.overall!=='met'||args.source.reviewStatus!=='verified'||!exactDay(args.source.observedDate)||!['Active','Suspended','Resigned','Removed'].includes(args.status))throw new Error('Membership transitions require a matched satisfied assessment and verified dated transition evidence.');
 const patch:any={status:args.status};if(typeof args.votingRights==='boolean')patch.votingRights=args.votingRights;
 await ctx.db.patch(args.memberId,patch);
 await ctx.db.insert('activity',{societyId,actor:'You',entityType:'member',subjectId:args.memberId,entityId:args.memberId,action:'evidenced_transition',summary:`Membership changed to ${args.status}; rule assessment ${args.assessmentId}; ${args.source.sourceUrl} — ${args.source.sourceReference}`,createdAtISO:new Date().toISOString()});return args.memberId;
}
