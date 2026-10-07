import type { PortableMutationCtx, PortableQueryCtx } from '../portable/ctx';
import { getOwned, requireOwnedRow, requireSocietyMembership } from './access';
import { requirePermissionPortable } from './permissions';
import { exactDay, partialDate, requireEvidence, uniqueRows } from '../evidenceReview';
import { requireLinkablePerson } from './personMerge';
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

/* ---------------- A2 / B1 / B2: organization members and representatives ---------------- */

const nowISO=()=>new Date().toISOString();
const newId=()=>globalThis.crypto?.randomUUID?.()??`obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
const orgKey=(name:string)=>name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** "PACHA / Board" → roster sheet "Board". */
export function seatRosterSheet(seat:any):string|undefined{return seat.rosterSheet??(seat.seatKey.includes(' / ')?seat.seatKey.split(' / ').slice(1).join(' / ').trim():undefined);}
/** Representative term start/end, accepting the older startDate/endDate names. */
export function observationTerm(o:any){return {termStart:o.termStart??o.startDate??undefined,termEnd:o.termEnd??o.endDate??undefined};}
/** Observations still in force (not superseded by a correction). */
export function liveObservations(seat:any){return (seat.observations??[]).filter((o:any)=>!o.supersededById);}
/** Representatives currently holding a seat: live representative/contact observations with no term end. */
export function currentRepresentatives(seat:any){
 const live=liveObservations(seat).filter((o:any)=>['representative','contact','organization_member'].includes(o.kind)&&o.personName&&!observationTerm(o).termEnd&&o.reviewStatus!=='rejected');
 const reps=live.filter((o:any)=>o.kind==='representative');
 return reps.length?reps:live;
}
async function requireSeat(ctx:PortableMutationCtx,seatId:string){const seat=await requireOwnedRow(ctx,'organizationSeats',seatId);const societyId=String(seat.societyId);await requirePermissionPortable(ctx,societyId,'members:write');return {seat,societyId};}
async function requirePerson(ctx:PortableQueryCtx,personId:string,societyId:string){return requireLinkablePerson(ctx,personId,societyId,{allowMerged:false});}
function checkTerm(o:any){
 const {termStart,termEnd}=observationTerm(o);
 if(!partialDate(termStart)||!partialDate(termEnd))throw new Error('Term dates must be YYYY, YYYY-MM or YYYY-MM-DD.');
 if(termStart&&termEnd&&termEnd<termStart)throw new Error('The representative term ends before it starts.');
}

export async function organizationMembers(ctx:PortableQueryCtx,{societyId}:{societyId:string}){
 await requireSocietyMembership(ctx,societyId);await requirePermissionPortable(ctx,societyId,'members:read');
 const [members,seats,committees]=await Promise.all([
  ctx.db.query('members').withIndex('by_society',q=>q.eq('societyId',societyId)).collect(),
  ctx.db.query('organizationSeats').withIndex('by_society',q=>q.eq('societyId',societyId)).collect(),
  ctx.db.query('committees').withIndex('by_society',q=>q.eq('societyId',societyId)).collect(),
 ]);
 const orgMembers=members.filter(m=>m.memberKind==='organization');
 const groups=new Map<string,any>();
 const group=(key:string,name:string)=>{let g=groups.get(key);if(!g){g={key,organizationName:name,member:null,seats:[]};groups.set(key,g);}return g;};
 for(const m of orgMembers){const name=m.organizationName||`${m.firstName} ${m.lastName}`.trim();group(`member:${m._id}`,name).member=m;}
 const byName=new Map(orgMembers.map(m=>[orgKey(m.organizationName||m.firstName),`member:${m._id}`]));
 const committeeName=new Map(committees.map(c=>[c._id,c.name]));
 for(const seat of seats){
  const key=seat.memberId?`member:${seat.memberId}`:byName.get(orgKey(seat.organizationName))??`org:${orgKey(seat.organizationName)}`;
  const live=liveObservations(seat);
  group(key,seat.organizationName).seats.push({
   _id:seat._id,seatKey:seat.seatKey,organizationName:seat.organizationName,memberId:seat.memberId,status:seat.status??'active',notes:seat.notes,
   rosterSheet:seatRosterSheet(seat),committeeId:seat.committeeId,committeeName:seat.committeeId?committeeName.get(seat.committeeId):undefined,
   current:currentRepresentatives(seat),observationCount:(seat.observations??[]).length,liveCount:live.length,
  });
 }
 const organizations=[...groups.values()].map(g=>({...g,seats:g.seats.sort((a:any,b:any)=>a.seatKey.localeCompare(b.seatKey)),linked:!!g.member})).sort((a,b)=>Number(b.linked)-Number(a.linked)||a.organizationName.localeCompare(b.organizationName));
 return {organizations,seatCount:seats.length,organizationMemberCount:orgMembers.length,unlinkedSeatCount:seats.filter(s=>!s.memberId).length};
}

/** Full observation history of one seat (loaded only when a seat is opened). */
export async function seatDetail(ctx:PortableQueryCtx,{seatId}:{seatId:string}){
 const seat=await requireOwnedRow(ctx,'organizationSeats',seatId);const societyId=String(seat.societyId);await requirePermissionPortable(ctx,societyId,'members:read');
 const proxies=(await ctx.db.query('seatProxyAuthorizations').withIndex('by_society',q=>q.eq('societyId',societyId)).collect()).filter(p=>p.seatId===seatId);
 return {...seat,rosterSheet:seatRosterSheet(seat),current:currentRepresentatives(seat),proxies};
}

export async function saveOrganizationMember(ctx:PortableMutationCtx,args:{societyId:string;memberId?:string;organizationName:string;membershipClass:string;status:string;joinedAt:string;leftAt?:string;votingRights:boolean;email?:string;notes?:string;linkSeatIds?:string[]}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');
 const name=args.organizationName.trim();if(!name||!args.membershipClass.trim()||!args.status.trim())throw new Error('Organization name, membership class and status are required.');
 if(!partialDate(args.joinedAt)||!args.joinedAt||!partialDate(args.leftAt))throw new Error('Joined date is required (YYYY, YYYY-MM or YYYY-MM-DD).');
 const fields={firstName:name,lastName:'',memberKind:'organization',organizationName:name,membershipClass:args.membershipClass.trim(),status:args.status.trim(),joinedAt:args.joinedAt,leftAt:args.leftAt||undefined,votingRights:args.votingRights,email:args.email?.trim()||undefined,notes:args.notes?.trim()||undefined};
 let memberId=args.memberId;
 if(memberId){await getOwned(ctx,'members',memberId,args.societyId);await ctx.db.patch(memberId,fields);}
 else{
  const existing=(await ctx.db.query('members').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect()).find(m=>m.memberKind==='organization'&&orgKey(m.organizationName??'')===orgKey(name));
  if(existing)throw new Error(`${existing.organizationName} is already an organization member.`);
  memberId=await ctx.db.insert('members',{societyId:args.societyId,...fields});
 }
 for(const seatId of args.linkSeatIds??[]){const seat=await getOwned(ctx,'organizationSeats',seatId,args.societyId);await ctx.db.patch(seat._id,{memberId,updatedAtISO:nowISO()});}
 await ctx.db.insert('activity',{societyId:args.societyId,actor:'You',entityType:'member',subjectId:memberId,entityId:memberId,action:args.memberId?'updated':'created',summary:`${args.memberId?'Updated':'Added'} organization member ${name}`,createdAtISO:nowISO()});
 return memberId;
}

export async function updateSeat(ctx:PortableMutationCtx,args:{seatId:string;memberId?:string|null;committeeId?:string|null;rosterSheet?:string;status?:string;notes?:string}){
 const {seat,societyId}=await requireSeat(ctx,args.seatId);const patch:any={updatedAtISO:nowISO()};
 if(args.memberId!==undefined){if(args.memberId){const m=await getOwned(ctx,'members',args.memberId,societyId);if(m.memberKind!=='organization')throw new Error('Link seats to an organization member.');}patch.memberId=args.memberId||undefined;}
 if(args.committeeId!==undefined){if(args.committeeId)await getOwned(ctx,'committees',args.committeeId,societyId);patch.committeeId=args.committeeId||undefined;}
 if(args.rosterSheet!==undefined)patch.rosterSheet=args.rosterSheet.trim()||undefined;
 if(args.status!==undefined){if(!['active','vacant','retired'].includes(args.status))throw new Error('Seat status must be active, vacant or retired.');patch.status=args.status;}
 if(args.notes!==undefined)patch.notes=args.notes.trim()||undefined;
 await ctx.db.patch(seat._id,patch);return seat._id;
}

export async function addSeat(ctx:PortableMutationCtx,args:{societyId:string;organizationName:string;seatKey?:string;memberId?:string;committeeId?:string;rosterSheet?:string}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');
 const organizationName=args.organizationName.trim();if(!organizationName)throw new Error('Organization name is required.');
 if(args.memberId)await getOwned(ctx,'members',args.memberId,args.societyId);if(args.committeeId)await getOwned(ctx,'committees',args.committeeId,args.societyId);
 const seats=await ctx.db.query('organizationSeats').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect();
 const base=(args.seatKey?.trim()||[organizationName,args.rosterSheet?.trim()].filter(Boolean).join(' / '));let seatKey=base;let n=2;
 while(seats.some(s=>s.seatKey===seatKey))seatKey=`${base} (${n++})`;
 return ctx.db.insert('organizationSeats',{societyId:args.societyId,seatKey,organizationName,observations:[],createdAtISO:nowISO(),...(args.memberId?{memberId:args.memberId}:{}),...(args.committeeId?{committeeId:args.committeeId}:{}),...(args.rosterSheet?.trim()?{rosterSheet:args.rosterSheet.trim()}:{}),status:'active'});
}

/** Record a representative term on a seat; optionally end the previous term on the same day (supersede, never rewrite). */
export async function recordRepresentative(ctx:PortableMutationCtx,args:{seatId:string;personId?:string;personName?:string;roleTitle?:string;termStart?:string;termEnd?:string;endPreviousObservationId?:string;notes?:string;source:{sourceUrl:string;sourceReference:string;reviewStatus:string;sourceExternalIds?:string[]}}){
 const {seat,societyId}=await requireSeat(ctx,args.seatId);
 let personName=args.personName?.trim()??'';
 if(args.personId){const person=await requirePerson(ctx,args.personId,societyId);personName=personName||person.fullName;}
 if(!personName)throw new Error('Choose the representative or enter the name as the source gives it.');
 if(!['pending','verified'].includes(args.source.reviewStatus))throw new Error('Review status must be pending or verified.');
 requireEvidence(args.source as any);
 const row:any={id:newId(),kind:'representative',personName,...(args.personId?{personId:args.personId}:{}),...(args.roleTitle?.trim()?{roleTitle:args.roleTitle.trim()}:{}),...(args.termStart?{termStart:args.termStart}:{}),...(args.termEnd?{termEnd:args.termEnd}:{}),...(args.notes?.trim()?{notes:args.notes.trim()}:{}),observedDate:args.termStart||args.termEnd||nowISO().slice(0,10),sourceUrl:args.source.sourceUrl,sourceReference:args.source.sourceReference,reviewStatus:args.source.reviewStatus,recordedAtISO:nowISO()};
 checkTerm(row);
 let observations=[...(seat.observations??[])];
 if(args.endPreviousObservationId){
  const index=observations.findIndex((o:any)=>o.id===args.endPreviousObservationId&&!o.supersededById);
  if(index<0)throw new Error('The previous representative observation was not found or was already corrected.');
  const previous=observations[index];if(observationTerm(previous).termEnd)throw new Error('The previous term already has an end date.');
  if(!args.termStart)throw new Error('Enter the date the new representative starts so the previous term can end.');
  const ended={...previous,id:newId(),kind:previous.kind==='contact'?'representative':previous.kind,termEnd:args.termStart,supersedes:previous.id,supersedeReason:`Representative changed to ${personName}`,sourceUrl:args.source.sourceUrl,sourceReference:args.source.sourceReference,reviewStatus:args.source.reviewStatus,recordedAtISO:nowISO()};
  checkTerm(ended);
  observations[index]={...previous,supersededById:ended.id,supersededAtISO:nowISO()};
  observations=[...observations,ended];
 }
 await ctx.db.patch(seat._id,{observations:[...observations,row],updatedAtISO:nowISO()});
 return row.id;
}

/** Correct a seat observation: the original stays in history, marked superseded. */
export async function supersedeSeatObservation(ctx:PortableMutationCtx,args:{seatId:string;observationId:string;changes:{personId?:string|null;personName?:string;roleTitle?:string;kind?:string;termStart?:string;termEnd?:string;notes?:string;reviewStatus?:string};rationale:string}){
 const {seat,societyId}=await requireSeat(ctx,args.seatId);
 if(!args.rationale.trim())throw new Error('Record why the observation is being corrected.');
 const observations=[...(seat.observations??[])];const index=observations.findIndex((o:any)=>o.id===args.observationId);
 if(index<0)throw new Error('Seat observation not found.');const old=observations[index];
 if(old.supersededById)throw new Error('This observation was already corrected. Correct the newer version.');
 const c=args.changes;const next:any={...old,id:newId(),supersedes:old.id,supersedeReason:args.rationale.trim(),recordedAtISO:nowISO()};
 delete next.supersededById;delete next.supersededAtISO;
 if(c.personId!==undefined){if(c.personId){const person=await requirePerson(ctx,c.personId,societyId);next.personId=c.personId;if(!c.personName)next.personName=person.fullName;}else delete next.personId;}
 for(const key of ['personName','roleTitle','termStart','termEnd','notes'] as const)if(c[key]!==undefined){if(c[key])next[key]=c[key];else delete next[key];}
 if(c.kind!==undefined){if(!['representative','contact','staff','vacant','organization_member'].includes(c.kind))throw new Error('Invalid observation kind.');next.kind=c.kind;}
 if(c.reviewStatus!==undefined){if(!['pending','verified','rejected'].includes(c.reviewStatus))throw new Error('Invalid review status.');next.reviewStatus=c.reviewStatus;}
 if(c.termStart!==undefined||c.termEnd!==undefined){delete next.startDate;delete next.endDate;}
 checkTerm(next);
 observations[index]={...old,supersededById:next.id,supersededAtISO:nowISO()};
 await ctx.db.patch(seat._id,{observations:[...observations,next],updatedAtISO:nowISO()});
 return next.id;
}
