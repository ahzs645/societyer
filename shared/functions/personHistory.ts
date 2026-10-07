import {filterDocumentLinkedRows,requireDocumentAccess} from "./documents";
import type {PortableMutationCtx,PortableQueryCtx} from '../portable/ctx';
import {getOwned} from './access';import {requirePermissionPortable,type Permission} from './permissions';
import {requireEvidence,partialDate} from '../evidenceReview';import {normalizeSearchName} from '../peopleDirectory';
import {PERSON_RECORD_PERMISSIONS,personRecordHref,personStateAt,dateBounds} from '../personHistory';
import {candidatePeopleForName,peopleNamedInFragment} from '../personMatching';
const now=()=>new Date().toISOString();
async function rows(ctx:PortableQueryCtx,table:string,societyId:string){return ctx.db.query(table).withIndex('by_society',q=>q.eq('societyId',societyId)).collect();}
async function permit(ctx:PortableQueryCtx,societyId:string,table:string,write=false){
 const resource=PERSON_RECORD_PERMISSIONS[table];if(!resource)throw new Error('Unsupported person record kind.');
 return requirePermissionPortable(ctx,societyId,`${resource}:${write?'write':'read'}` as Permission);
}
async function readable(ctx:PortableQueryCtx,societyId:string,table:string){
 try{await permit(ctx,societyId,table);return true;}catch(e){if(e instanceof Error&&/^(Permission|Service scope) .* required\.$/.test(e.message))return false;throw e;}
}
async function visibleOccurrences(ctx:PortableQueryCtx,societyId:string,recordFilter?:{recordTable:string;recordId:string},personId?:string){
 const all=recordFilter?await ctx.db.query('personOccurrences').withIndex('by_record',q=>q.eq('societyId',societyId).eq('recordTable',recordFilter.recordTable).eq('recordId',recordFilter.recordId)).collect():personId?await ctx.db.query('personOccurrences').withIndex('by_person',q=>q.eq('societyId',societyId).eq('personId',personId)).collect():await rows(ctx,'personOccurrences',societyId);const allowed=new Set<string>();
 for(const table of new Set(all.map(o=>o.recordTable)))if(await readable(ctx,societyId,table))allowed.add(table);
 const selected=all.filter(o=>allowed.has(o.recordTable)).map(o=>{const reviewed=[...o.reviewHistory].reverse().find(h=>h.correctedSourceReference);return reviewed?{...o,originalSourceReference:o.sourceReference,sourceReference:reviewed.correctedSourceReference,...(Object.prototype.hasOwnProperty.call(reviewed,'correctedRoleTitle')?{originalRoleTitle:o.roleTitle,roleTitle:reviewed.correctedRoleTitle||undefined}:{})}:o;});const records=new Map<string,any>();const decorated:any[]=[];
 for(const o of selected){const key=o.recordTable+':'+o.recordId;let record=records.get(key);if(!record){record=await ctx.db.get(o.recordId,o.recordTable);records.set(key,record);}if(!record||record.societyId!==societyId)continue;
  const ids=Array.from(new Set([...(record.sourceDocumentIds??[]),...(o.documentId?[o.documentId]:[]),...(o.recordTable==='documents'?[o.recordId]:[])]));
  if(ids.length&&!await readable(ctx,societyId,'documents'))continue;
  decorated.push({...o,sourceDocumentIds:ids});
 }
 const linked=decorated.filter(o=>o.sourceDocumentIds.length);const visible=await filterDocumentLinkedRows(ctx,societyId,linked);const ids=new Set(visible.map(o=>o._id));
 return decorated.filter(o=>!o.sourceDocumentIds.length||ids.has(o._id));
}
async function visibleEvents(ctx:PortableQueryCtx,societyId:string,personId:string,occurrences:any[]){
 const all=await ctx.db.query('personHistoryEvents').withIndex('by_person',q=>q.eq('societyId',societyId).eq('personId',personId)).collect();
 const allowed=new Set(occurrences.map(o=>o._id));const result:any[]=[];
 for(const event of all){
  if(event.sourceOccurrenceId&&!allowed.has(event.sourceOccurrenceId))continue;
  if(event.meetingId&&!await readable(ctx,societyId,'meetings'))continue;
  if(event.documentId&&!await readable(ctx,societyId,'documents'))continue;
  if(['role','appointment','departure'].includes(event.kind)&&!await readable(ctx,societyId,'directors'))continue;
  const occurrence=occurrences.find(o=>o._id===event.sourceOccurrenceId);
  const projected=event.reviewStatus==='verified'&&occurrence&&occurrence.matchStatus!=='verified'?{...event,storedReviewStatus:event.reviewStatus,reviewStatus:'pending',identityReviewNeeded:true}:event;
  result.push(occurrence?.matchStatus==='assumed'?{...projected,identityMatchStatus:'assumed',testOnlyAssumption:true}:projected);
 }return result;
}
export async function overview(ctx:PortableQueryCtx,{societyId}:{societyId:string}){
 await requirePermissionPortable(ctx,societyId,'members:read');
 const [allPeople,occurrences]=await Promise.all([rows(ctx,'peopleDirectory',societyId),visibleOccurrences(ctx,societyId)]);
 const people=allPeople.filter(p=>!p.mergedIntoId);const counts=new Map<string,{n:number;u:number}>();
 for(const o of occurrences)if(o.personId){const c=counts.get(o.personId)??{n:0,u:0};c.n++;if(o.matchStatus!=='verified')c.u++;counts.set(o.personId,c);}
 const candidateCache=new Map<string,any[]>();
 const candidatesFor=(name:string)=>{const key=normalizeSearchName(name);let hit=candidateCache.get(key);if(!hit){hit=candidatePeopleForName(people as any[],name,{fuzzy:false}).map(c=>({id:c.person._id,name:c.person.fullName,reason:c.reason}));candidateCache.set(key,hit);}return hit;};
 const namedCache=new Map<string,any[]>();
 const namedIn=(fragment:string)=>{let hit=namedCache.get(fragment);if(!hit){hit=peopleNamedInFragment(people as any[],fragment).map(p=>({id:p._id,name:p.fullName}));namedCache.set(fragment,hit);}return hit;};
 return {people:people.map(p=>({...p,occurrences:counts.get(p._id)?.n??0,unreviewed:counts.get(p._id)?.u??0})),
 // P11: single given names list every person with that given name or a variant.
 // P10: fragments marked not_person that contain a known person's full name.
 occurrences:occurrences.map(o=>({...o,href:personRecordHref(o),candidates:candidatesFor(o.personName),...(o.matchStatus==='not_person'||o.personName.trim().split(/\s+/).length>3?{namedPeople:namedIn(o.personName)}:{})}))};
}
export async function profile(ctx:PortableQueryCtx,{societyId,personId,asOf}:{societyId:string;personId:string;asOf?:string}){
 await requirePermissionPortable(ctx,societyId,'members:read');
 // P12: a profile outside this workspace is reported as not found (never a spinner).
 const candidate=await ctx.db.get(personId,'peopleDirectory');
 if(!candidate||candidate.societyId!==societyId)return {notFound:true as const};
 const person=candidate;
 if(person.mergedIntoId){const survivor=await ctx.db.get(person.mergedIntoId,'peopleDirectory');return {notFound:false as const,mergedInto:{_id:person.mergedIntoId,fullName:survivor?.fullName??'another profile'},person,registers:[],contactPoints:[],events:[],historical:null,occurrences:[]};}
 const occurrences=await visibleOccurrences(ctx,societyId,undefined,personId);
 const events=await visibleEvents(ctx,societyId,personId,occurrences);
 const members=(await rows(ctx,'members',societyId)).filter(r=>r.directoryPersonId===personId);
 const directors=await readable(ctx,societyId,'directors')?(await rows(ctx,'directors',societyId)).filter(r=>r.directoryPersonId===personId||members.some(m=>m._id===r.memberId)):[];
 const registers=[...members.map(r=>({...r,recordTable:'members',href:`/app/members/${r._id}`})),...directors.map(r=>({...r,recordTable:'directors',href:'/app/directors'}))];
 const memberIds=new Set(members.map(m=>m._id));
 for(const e of await rows(ctx,'memberHistoryEvents',societyId))if(memberIds.has(e.memberId))events.push({...e,derived:true,kind:'observation',scope:'Member history',transition:'observed',reviewStatus:e.reviewStatus==='Verified'?'verified':e.reviewStatus==='Rejected'?'rejected':'pending',href:`/app/members/${e.memberId}`});
 const visibleOccurrenceIds=new Set(occurrences.map(o=>o._id));
 const contactPoints=(await ctx.db.query('personContactPoints').withIndex('by_person',q=>q.eq('societyId',societyId).eq('personId',personId)).collect()).filter(p=>!p.sourceOccurrenceId||visibleOccurrenceIds.has(p.sourceOccurrenceId)).map(p=>{const occurrence=occurrences.find(o=>o._id===p.sourceOccurrenceId);const projected=p.reviewStatus==='verified'&&occurrence&&occurrence.matchStatus!=='verified'?{...p,storedReviewStatus:p.reviewStatus,reviewStatus:'pending'}:p;return occurrence?.matchStatus==='assumed'?{...projected,testOnlyAssumption:true}:projected;});
 return {person,registers,contactPoints,events:events.sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)),historical:asOf?personStateAt(events,asOf):null,
 occurrences:occurrences.map(o=>({...o,href:personRecordHref(o),historical:o.observedDate?.length===10?personStateAt(events,o.observedDate):null}))};
}
export async function forRecord(ctx:PortableQueryCtx,{societyId,recordTable,recordId}:{societyId:string;recordTable:string;recordId:string}){
 await requirePermissionPortable(ctx,societyId,'members:read');await permit(ctx,societyId,recordTable);await getOwned(ctx,recordTable,recordId,societyId);
 const all=await visibleOccurrences(ctx,societyId,{recordTable,recordId});
 return Promise.all(all.map(async o=>({...o,href:personRecordHref(o),person:o.personId?await getOwned(ctx,'peopleDirectory',o.personId,societyId):null})));
}
export async function createContact(ctx:PortableMutationCtx,args:{societyId:string;fullName:string;aliases?:string[];sourceKey?:string}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');if(!args.fullName.trim())throw new Error('A person name is required.');
 if(args.sourceKey){const existing=(await rows(ctx,'peopleDirectory',args.societyId)).find(p=>p.sourceKey===args.sourceKey);if(existing){if(existing.fullName!==args.fullName.trim())throw new Error('Contact source identity conflicts.');return existing._id;}}
 return ctx.db.insert('peopleDirectory',{societyId:args.societyId,fullName:args.fullName.trim(),searchName:normalizeSearchName(args.fullName),aliases:args.aliases??[],isIndividual:true,identityReviewStatus:'pending',...(args.sourceKey?{sourceKey:args.sourceKey}:{}),createdAtISO:now(),updatedAtISO:now()});
}
export async function setAliases(ctx:PortableMutationCtx,args:{societyId:string;personId:string;aliases:string[];source:any}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');const person=await getOwned(ctx,'peopleDirectory',args.personId,args.societyId);requireEvidence(args.source);
 if(args.source.reviewStatus!=='verified')throw new Error('Alias evidence must be reviewed.');
 const aliases=Array.from(new Set([...(person.aliases??[]),...args.aliases.map(n=>n.trim()).filter(Boolean)]));
 await ctx.db.patch(args.personId,{aliases,aliasEvidence:[...(person.aliasEvidence??[]),{aliases:args.aliases,...args.source,recordedAtISO:now()}],updatedAtISO:now()});return args.personId;
}
export async function observe(ctx:PortableMutationCtx,{societyId,observation}:{societyId:string;observation:any}){
 await requirePermissionPortable(ctx,societyId,'members:write');await permit(ctx,societyId,observation.recordTable);const sourceRecord=await getOwned(ctx,observation.recordTable,observation.recordId,societyId);requireEvidence(observation);
 for(const id of [...(sourceRecord.sourceDocumentIds??[]),...(observation.recordTable==='documents'?[observation.recordId]:[])]){await permit(ctx,societyId,'documents');await requireDocumentAccess(ctx,id);}
 if(!observation.occurrenceKey?.trim()||!observation.personName?.trim()||!observation.context?.trim()||!partialDate(observation.observedDate))throw new Error('A source occurrence needs a stable key, source name, context and valid date precision.');
 for(const [field,table]of [['meetingId','meetings'],['documentId','documents']])if(observation[field]){await permit(ctx,societyId,table);await getOwned(ctx,table,observation[field],societyId);if(table==='documents')await requireDocumentAccess(ctx,observation[field]);}
 if(observation.personId)await getOwned(ctx,'peopleDirectory',observation.personId,societyId);
 const fields=['occurrenceKey','recordTable','recordId','personName','context','observedDate','roleTitle','affiliation','notes','meetingId','documentId','sourceUrl','sourceReference','sourceExternalId'];
 const values:any=Object.fromEntries(fields.filter(k=>observation[k]!==undefined).map(k=>[k,observation[k]]));
 const existing=(await ctx.db.query('personOccurrences').withIndex('by_key',q=>q.eq('societyId',societyId).eq('occurrenceKey',observation.occurrenceKey)).collect())[0];
 if(existing){for(const k of fields)if(existing[k]!==values[k])throw new Error('Source occurrences are append-only; use a new key for corrected evidence.');return existing._id;}
 return ctx.db.insert('personOccurrences',{...values,societyId,...(observation.personId?{personId:observation.personId}:{}),matchStatus:observation.personId?'suggested':'unresolved',reviewHistory:[],createdAtISO:now()});
}
export async function reviewMatch(ctx:PortableMutationCtx,args:{societyId:string;occurrenceId:string;personId?:string;status:string;rationale:string;source:any;testOnly?:boolean}){
 const actor=await requirePermissionPortable(ctx,args.societyId,'members:write');const occurrence=await getOwned(ctx,'personOccurrences',args.occurrenceId,args.societyId);
 await permit(ctx,args.societyId,occurrence.recordTable);
 if(args.personId){const target=await ctx.db.get(args.personId,'peopleDirectory');if(target?.mergedIntoId)throw new Error('That profile was merged. Choose the surviving profile.');}
 if(!(await visibleOccurrences(ctx,args.societyId,{recordTable:occurrence.recordTable,recordId:occurrence.recordId})).some(o=>o._id===occurrence._id))throw new Error('Person source record not found.');
 requireEvidence(args.source);
 if(!['verified','assumed','rejected','unresolved','not_person'].includes(args.status)||!args.rationale.trim())throw new Error('Select a review outcome and record the identity rationale.');
 if(args.status==='verified'&&(!args.personId||args.source.reviewStatus!=='verified'))throw new Error('A confirmed match needs a selected person and reviewed source evidence.');
 if(args.status==='assumed'&&(!args.personId||args.testOnly!==true))throw new Error('A test assumption needs a selected person and explicit test-only acknowledgement.');
 if(args.status==='assumed'&&occurrence.matchStatus==='verified')throw new Error('A confirmed source identity cannot be replaced by a test assumption.');
 if(args.personId)await getOwned(ctx,'peopleDirectory',args.personId,args.societyId);
 if(args.status==='verified'&&occurrence.recordTable==='directors'){
  const director=await getOwned(ctx,'directors',occurrence.recordId,args.societyId);
  if(director.memberId){const member=await getOwned(ctx,'members',director.memberId,args.societyId);if(member.directoryPersonId&&member.directoryPersonId!==args.personId)throw new Error('The linked member has a different confirmed person identity.');}
 }
 if(args.status==='verified'&&occurrence.recordTable==='members'){
  const directors=await rows(ctx,'directors',args.societyId);
  if(directors.some(d=>d.memberId===occurrence.recordId&&d.directoryPersonId&&d.directoryPersonId!==args.personId))throw new Error('A linked director has a different confirmed person identity.');
 }
 const previous={personId:occurrence.personId??null,status:occurrence.matchStatus};
 const isTestOnly=args.status==='assumed'||args.status==='not_person'&&args.testOnly===true;
 const review={...args.source,previous,personId:args.personId??null,status:args.status,rationale:args.rationale,...(isTestOnly?{testOnly:true,reviewStatus:'pending'}:{}),reviewedAtISO:now(),reviewedByUserId:actor._id};
 await ctx.db.patch(args.occurrenceId,{personId:args.personId,matchStatus:args.status,reviewHistory:[...occurrence.reviewHistory,review]});
 if(!isTestOnly&&occurrence.recordTable==='minutes'&&/attendance/i.test(occurrence.context)){
  const matches=await ctx.db.query('meetingAttendanceRecords').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect();
  for(const record of matches.filter(r=>r.minutesId===occurrence.recordId&&r.personName===occurrence.personName))await ctx.db.patch(record._id,{directoryPersonId:args.status==='verified'?args.personId:undefined,identityReviewStatus:args.status});
 }
 if(!isTestOnly&&['members','directors'].includes(occurrence.recordTable)){
  await permit(ctx,args.societyId,occurrence.recordTable,true);
  await ctx.db.patch(occurrence.recordId,{directoryPersonId:args.status==='verified'?args.personId:undefined});
 }
 // P8: history events and contact details recorded from this occurrence move
 // with it to the newly linked person (never left behind, never deleted).
 if(args.personId&&occurrence.personId&&args.personId!==occurrence.personId)await moveOccurrenceHistory(ctx,args.societyId,occurrence._id,occurrence.personId,args.personId,actor._id,args.rationale);
 return args.occurrenceId;
}
export async function moveOccurrenceHistory(ctx:PortableMutationCtx,societyId:string,occurrenceId:string,fromPersonId:string,toPersonId:string,actorId:string,rationale:string){
 const events=(await ctx.db.query('personHistoryEvents').withIndex('by_person',q=>q.eq('societyId',societyId).eq('personId',fromPersonId)).collect()).filter(e=>e.sourceOccurrenceId===occurrenceId);
 for(const e of events)await ctx.db.patch(e._id,{personId:toPersonId,reviewHistory:[...(e.reviewHistory??[]),{kind:'relink',fromPersonId,toPersonId,rationale,reviewedAtISO:now(),reviewedByUserId:actorId}]});
 const contacts=(await ctx.db.query('personContactPoints').withIndex('by_person',q=>q.eq('societyId',societyId).eq('personId',fromPersonId)).collect()).filter(c=>c.sourceOccurrenceId===occurrenceId);
 for(const c of contacts)await ctx.db.patch(c._id,{personId:toPersonId});
 return events.length+contacts.length;
}
/** Apply cited interface assumptions in one bounded transaction, retaining later human choices. */
export async function applyTestAssumptions(ctx:PortableMutationCtx,args:{societyId:string;testOnly:boolean;assignments:Array<{occurrenceId:string;personId?:string;status?:string;rationale:string;source:any;expectedReviewHistoryLength?:number}>}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');
 if(args.testOnly!==true||!Array.isArray(args.assignments)||args.assignments.length>200)throw new Error('Test assumption batches require explicit test-only acknowledgement and at most 200 assignments.');
 const results:Array<{occurrenceId:string;status:string}>=[];
 for(const assignment of args.assignments){
  const status=assignment.status??'assumed';if(!['assumed','not_person'].includes(status))throw new Error('Test batches support assumed identities or non-person fragments only.');
  const occurrence=await getOwned(ctx,'personOccurrences',assignment.occurrenceId,args.societyId);
  await permit(ctx,args.societyId,occurrence.recordTable);
  if(!(await visibleOccurrences(ctx,args.societyId,{recordTable:occurrence.recordTable,recordId:occurrence.recordId})).some(o=>o._id===occurrence._id))throw new Error('Person source record not found.');
  if(['verified','rejected','not_person','assumed'].includes(occurrence.matchStatus)||assignment.expectedReviewHistoryLength!==undefined&&occurrence.reviewHistory.length!==assignment.expectedReviewHistoryLength||occurrence.reviewHistory.some((review:any)=>review.status&&!review.correctedSourceReference)){
   results.push({occurrenceId:assignment.occurrenceId,status:'preserved'});continue;
  }
  await reviewMatch(ctx,{societyId:args.societyId,...assignment,personId:status==='not_person'?undefined:assignment.personId,status,testOnly:true});
  results.push({occurrenceId:assignment.occurrenceId,status});
 }
 return {applied:results.filter(row=>row.status!=='preserved').length,preserved:results.filter(row=>row.status==='preserved').length,results};
}
/** Stage source-name mentions as annotations, never as attendance or adopted minutes. */
export async function stageTestMentions(ctx:PortableMutationCtx,args:{societyId:string;testOnly:boolean;mentions:Array<{observation:any;personId?:string;rationale:string;note?:{eventKey:string;title:string;details:string;effectiveDate?:string}}>}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');
 if(args.testOnly!==true||!Array.isArray(args.mentions)||args.mentions.length>200)throw new Error('Test mention batches require explicit test-only acknowledgement and at most 200 mentions.');
 const results:any[]=[];
 for(const mention of args.mentions){
  if(mention.observation.recordTable!=='minutes'||!mention.rationale.trim())throw new Error('A test mention needs a minutes source record and a cited rationale.');
  const observation={...mention.observation,context:`Contextual source mention — ${mention.observation.context||'Source name reference; attendance and speaker attribution unconfirmed'}`,personId:mention.personId};
  const occurrenceId=await observe(ctx,{societyId:args.societyId,observation});
  const result=mention.personId?await applyTestAssumptions(ctx,{societyId:args.societyId,testOnly:true,assignments:[{occurrenceId,personId:mention.personId,rationale:mention.rationale,source:{sourceUrl:observation.sourceUrl,sourceReference:observation.sourceReference,reviewStatus:'pending'}}]}):null;
  const occurrence=await getOwned(ctx,'personOccurrences',occurrenceId,args.societyId);let eventId;
  if(mention.note&&mention.personId&&occurrence.personId===mention.personId&&!['rejected','not_person'].includes(occurrence.matchStatus)){
   const existingNote=(await ctx.db.query('personHistoryEvents').withIndex('by_key',q=>q.eq('societyId',args.societyId).eq('eventKey',mention.note!.eventKey)).collect())[0];
   if(existingNote){if(existingNote.personId!==mention.personId||existingNote.sourceOccurrenceId!==occurrenceId)throw new Error('The test note key belongs to a different source identity.');eventId=existingNote._id;}
   else eventId=await addEvent(ctx,{societyId:args.societyId,personId:mention.personId,event:{eventKey:mention.note.eventKey,kind:'note',title:mention.note.title,details:mention.note.details,scope:'Source meeting context',effectiveDate:mention.note.effectiveDate??observation.observedDate,transition:'observed',reviewStatus:'pending',sourceOccurrenceId:occurrenceId,...(observation.meetingId?{meetingId:observation.meetingId}:{}),...(observation.documentId?{documentId:observation.documentId}:{}),sourceUrl:observation.sourceUrl,sourceReference:observation.sourceReference,...(observation.sourceExternalId?{sourceExternalId:observation.sourceExternalId}:{})}});
  }
  results.push({occurrenceId,...(eventId?{eventId}:{}),status:result?.results[0].status??'unresolved'});
 }
 return {staged:results.length,assumed:results.filter(row=>row.status==='assumed').length,results};
}
export async function addEvent(ctx:PortableMutationCtx,{societyId,personId,event}:{societyId:string;personId:string;event:any}){
 const actor=await requirePermissionPortable(ctx,societyId,'members:write');await getOwned(ctx,'peopleDirectory',personId,societyId);requireEvidence(event);
 if(!['role','affiliation','appointment','departure','observation','note'].includes(event.kind)||!event.eventKey?.trim()||!event.title?.trim()||!event.scope?.trim()||!event.effectiveDate||!partialDate(event.effectiveDate)||!partialDate(event.endDate)||!['pending','verified','rejected'].includes(event.reviewStatus)||!['observed','started','changed','ended'].includes(event.transition))throw new Error('A history event needs a kind, scope, title, stable key and source date precision.');
 if(['role','appointment','departure'].includes(event.kind))await requirePermissionPortable(ctx,societyId,'directors:write');
 if(event.endDate&&dateBounds(event.endDate)[1]<dateBounds(event.effectiveDate)[0])throw new Error('The history interval is reversed.');
 if(['role','affiliation'].includes(event.kind)&&event.transition==='observed')throw new Error('Use an observation for a point-in-time role or affiliation; effective changes require their historical start date.');
 if(event.supersedesEventId){const old=await getOwned(ctx,'personHistoryEvents',event.supersedesEventId,societyId);if(old.personId!==personId||old.kind!==event.kind||old.scope!==event.scope||dateBounds(event.effectiveDate)[0]<dateBounds(old.effectiveDate)[1])throw new Error('A dated change must follow the preceding event for the same person, kind and scope.');}
 if(event.sourceOccurrenceId){const o=await getOwned(ctx,'personOccurrences',event.sourceOccurrenceId,societyId);await permit(ctx,societyId,o.recordTable);if(o.personId!==personId)throw new Error('History source does not match the selected person.');if(event.reviewStatus==='verified'&&o.matchStatus!=='verified')throw new Error('Confirm the source identity before verifying its history.');}
 for(const [field,table]of [['meetingId','meetings'],['documentId','documents']])if(event[field]){await permit(ctx,societyId,table);await getOwned(ctx,table,event[field],societyId);}
 const fields=['eventKey','kind','title','value','roleTitle','affiliation','scope','effectiveDate','endDate','transition','details','reviewStatus','supersedesEventId','sourceOccurrenceId','meetingId','documentId','sourceUrl','sourceReference','sourceExternalId'];const values:any=Object.fromEntries(fields.filter(k=>event[k]!==undefined).map(k=>[k,event[k]]));
 const old=(await ctx.db.query('personHistoryEvents').withIndex('by_key',q=>q.eq('societyId',societyId).eq('eventKey',event.eventKey)).collect())[0];
 if(old){if(old.personId!==personId||fields.some(k=>old[k]!==values[k]))throw new Error('Person history is append-only.');return old._id;}
 return ctx.db.insert('personHistoryEvents',{...values,societyId,personId,createdAtISO:now(),createdByUserId:actor._id});
}
export async function reviewEvent(ctx:PortableMutationCtx,args:{societyId:string;eventId:string;status:string;rationale:string}){
 const actor=await requirePermissionPortable(ctx,args.societyId,'members:write');const event=await getOwned(ctx,'personHistoryEvents',args.eventId,args.societyId);
 if(!['pending','verified','rejected'].includes(args.status)||!args.rationale.trim())throw new Error('Record a review outcome and rationale.');
 if(['role','appointment','departure'].includes(event.kind))await requirePermissionPortable(ctx,args.societyId,'directors:write');
 if(event.sourceOccurrenceId){const o=await getOwned(ctx,'personOccurrences',event.sourceOccurrenceId,args.societyId);await permit(ctx,args.societyId,o.recordTable);if(args.status==='verified'&&(o.personId!==event.personId||o.matchStatus!=='verified'))throw new Error('Confirm the source identity before verifying this history event.');}
 if(event.meetingId)await permit(ctx,args.societyId,'meetings');if(event.documentId)await permit(ctx,args.societyId,'documents');
 await ctx.db.patch(args.eventId,{reviewStatus:args.status,reviewHistory:[...(event.reviewHistory??[]),{previousStatus:event.reviewStatus,status:args.status,rationale:args.rationale,reviewedAtISO:now(),reviewedByUserId:actor._id}]});return args.eventId;
}
/** Refresh source-name annotations without modifying a minutes revision. */
export async function stageRecord(ctx:PortableMutationCtx,args:{societyId:string;recordTable:string;recordId:string;sourceUrl:string;sourceReference:string}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');await permit(ctx,args.societyId,args.recordTable);requireEvidence(args);
 const record=await getOwned(ctx,args.recordTable,args.recordId,args.societyId);const entries:any[]=[];
 if(args.recordTable==='minutes'){
  for(const [status,names] of [['Present',record.attendees??[]],['Absent',record.absent??[]]] as const)for(const name of names)entries.push({personName:name,context:`Attendance (${status})`,observedDate:String(record.heldAt).slice(0,10),meetingId:record.meetingId});
  for(const d of record.attendanceEvents??[]){if(d.personName)entries.push({personName:d.personName,context:`Attendance event (${d.kind})`,notes:d.boundary,observedDate:String(record.heldAt).slice(0,10),meetingId:record.meetingId});if(d.principalName)entries.push({personName:d.principalName,context:'Proxy principal observed',notes:d.boundary,observedDate:String(record.heldAt).slice(0,10),meetingId:record.meetingId});}
  for(const d of record.detailedAttendance??[])entries.push({personName:d.name,context:`Detailed attendance (${d.status})`,roleTitle:d.roleTitle,affiliation:d.affiliation,notes:d.notes,observedDate:String(record.heldAt).slice(0,10),meetingId:record.meetingId});
 }else if(args.recordTable==='organizationSeats'){for(const d of record.observations??[])if(d.personName)entries.push({personName:d.personName,context:`Seat ${record.organizationName} (${d.kind})`,roleTitle:d.roleTitle,affiliation:record.organizationName,observedDate:d.observedDate,notes:d.notes});}
 else if(['members','directors'].includes(args.recordTable))entries.push({personName:`${record.firstName} ${record.lastName}`.trim(),context:'Register identity'});
 else throw new Error('Stage source names from minutes, seats or a person register.');
 const ids:string[]=[];
 for(const entry of entries){
  // Include source content in the key so corrections append evidence instead of rewriting it.
  const key=`staged:${args.recordTable}:${args.recordId}:${JSON.stringify(entry)}`;
  ids.push(await observe(ctx,{societyId:args.societyId,observation:{...entry,occurrenceKey:key,recordTable:args.recordTable,recordId:args.recordId,sourceUrl:args.sourceUrl,sourceReference:args.sourceReference}}));
 }return ids;
}
export async function addContactPoint(ctx:PortableMutationCtx,args:{societyId:string;personId:string;point:any}){
 await requirePermissionPortable(ctx,args.societyId,'members:write');await getOwned(ctx,'peopleDirectory',args.personId,args.societyId);const p=args.point;requireEvidence(p);
 if(!p.pointKey?.trim()||!['email','phone','address','other'].includes(p.kind)||!p.value?.trim()||!p.observedDate||!partialDate(p.observedDate)||!['pending','verified','rejected'].includes(p.reviewStatus))throw new Error('Record a contact value with its source period and review status.');
 if(p.sourceOccurrenceId){const occurrence=await getOwned(ctx,'personOccurrences',p.sourceOccurrenceId,args.societyId);if(occurrence.personId!==args.personId)throw new Error('Contact source belongs to a different person.');if(!(await visibleOccurrences(ctx,args.societyId,{recordTable:occurrence.recordTable,recordId:occurrence.recordId})).some(o=>o._id===occurrence._id))throw new Error('Contact source not found.');if(p.reviewStatus==='verified'&&occurrence.matchStatus!=='verified')throw new Error('Confirm the source identity before verifying contact details.');}
 const fields=['pointKey','kind','value','observedDate','reviewStatus','sourceOccurrenceId','sourceUrl','sourceReference'];const values:any=Object.fromEntries(fields.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
 const old=(await ctx.db.query('personContactPoints').withIndex('by_key',q=>q.eq('societyId',args.societyId).eq('pointKey',p.pointKey)).collect())[0];if(old){if(old.personId!==args.personId||fields.some(k=>old[k]!==values[k]))throw new Error('Contact observations are append-only.');return old._id;}
 return ctx.db.insert('personContactPoints',{...values,societyId:args.societyId,personId:args.personId,createdAtISO:now()});
}
