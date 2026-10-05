import assert from 'node:assert/strict';
import {MemoryDb,LocalStoreDb,MemoryRowStore,PortableRuntime,makeCapabilities} from '../shared/portable/index';
import {PORTABLE_FUNCTIONS} from '../shared/functions/registry';
import {portableTestSeed,portableTestPrincipal} from './portable-test-fixture';
import {convexTest} from 'convex-test';
import {anyApi} from 'convex/server';
import schema from '../convex/schema';
import {betterAuthIssuer} from '../convex/lib/authIdentity';

const source={sourceUrl:'https://example.invalid/assumptions',sourceReference:'Fictional interface assumption fixture',reviewStatus:'pending'};
for(const engine of ['memory','local-store']){
 const societyId='person_assumption_tests';
 const seed:any={...portableTestSeed(societyId),meetings:[{_id:'meeting_assumption',societyId,title:'Fictional meeting',scheduledAt:'2020-06-15',type:'Board',status:'Held',electronic:false,attendeeIds:[]}],minutes:[{_id:'minute_assumption',societyId,meetingId:'meeting_assumption',heldAt:'2020-06-15',attendees:['Alex Example'],absent:[],quorumMet:false,discussion:'Original wording',decisions:[],actionItems:[]}],meetingAttendanceRecords:[{_id:'attendance_assumption',societyId,minutesId:'minute_assumption',personName:'Alex Example'}],members:[{_id:'member_assumption',societyId,firstName:'Alex',lastName:'Example',votingRights:false}],directors:[{_id:'director_assumption',societyId,firstName:'Alex',lastName:'Example'}]};
 const db=engine==='memory'?new MemoryDb({seed}):new LocalStoreDb(new MemoryRowStore(seed));
 const runtime=new PortableRuntime({db,capabilities:makeCapabilities({}),principalProvider:portableTestPrincipal}).registerAll(PORTABLE_FUNCTIONS);
 const mutate=(name:string,args:any)=>runtime.runMutation(name,args),query=(name:string,args:any)=>runtime.runQuery(name,args);
 const personId=await mutate('personHistory:createContact',{societyId,fullName:'Alex Example'});
 const occurrenceId=await mutate('personHistory:observe',{societyId,observation:{occurrenceKey:'attendance',recordTable:'minutes',recordId:'minute_assumption',personName:'Alex Example',context:'Attendance',observedDate:'2020-06-15',meetingId:'meeting_assumption',...source}});
 const args={societyId,occurrenceId,personId,status:'assumed',rationale:'Same source name; assumed solely to explore the test interface',source};
 await assert.rejects(()=>mutate('personHistory:reviewMatch',args),/test-only acknowledgement/);
 await mutate('personHistory:reviewMatch',{...args,testOnly:true});
 const stored:any=await db.get(String(occurrenceId));assert.equal(stored.matchStatus,'assumed');assert.equal(stored.reviewHistory[0].testOnly,true);assert.equal(stored.reviewHistory[0].reviewStatus,'pending');
 assert.equal((await db.get('attendance_assumption'))!.directoryPersonId,undefined);
 const event={eventKey:'note',kind:'observation',scope:'Meeting',title:'Source note',effectiveDate:'2020-06-15',transition:'observed',sourceOccurrenceId:occurrenceId,affiliation:'Assumed organization',...source};
 const eventId=await mutate('personHistory:addEvent',{societyId,personId,event});
 await assert.rejects(()=>mutate('personHistory:reviewEvent',{societyId,eventId,status:'verified',rationale:'Cannot promote an assumed identity'}),/Confirm the source identity/);
 const profile:any=await query('personHistory:profile',{societyId,personId,asOf:'2020-06-15'});
 assert.equal(profile.events[0].testOnlyAssumption,true);assert.equal(profile.historical.affiliation.state,'unknown');assert.equal(profile.occurrences[0].href,'/app/meetings/meeting_assumption?tab=minutes');
 const reverse:any=await query('personHistory:forRecord',{societyId,recordTable:'minutes',recordId:'minute_assumption'});assert.equal(reverse[0].person._id,personId);assert.equal(reverse[0].matchStatus,'assumed');
 for(const [table,id] of [['members','member_assumption'],['directors','director_assumption']]){
  const registerOccurrence=await mutate('personHistory:observe',{societyId,observation:{occurrenceKey:table,recordTable:table,recordId:id,personName:'Alex Example',context:'Register source identity',...source}});
  await mutate('personHistory:reviewMatch',{...args,occurrenceId:registerOccurrence,testOnly:true});assert.equal((await db.get(id))!.directoryPersonId,undefined);
 }
 assert.equal((await db.get('member_assumption'))!.votingRights,false);assert.equal((await db.get('minute_assumption'))!.discussion,'Original wording');
 const batchOccurrence=await mutate('personHistory:observe',{societyId,observation:{occurrenceKey:'batch-source',recordTable:'minutes',recordId:'minute_assumption',personName:'A. Example',context:'Meeting note',...source}});
 const batchAssignment={occurrenceId:batchOccurrence,personId,rationale:'Fictional initial and meeting context',source,expectedReviewHistoryLength:0};
 await assert.rejects(()=>mutate('personHistory:applyTestAssumptions',{societyId,testOnly:true,assignments:[batchAssignment,{...batchAssignment,occurrenceId:'missing_occurrence'}]}),/not found/i);
 assert.equal((await db.get(String(batchOccurrence)))!.matchStatus,'unresolved');
 const batch:any=await mutate('personHistory:applyTestAssumptions',{societyId,testOnly:true,assignments:[batchAssignment,{...batchAssignment,occurrenceId}]});assert.equal(batch.applied,1);assert.equal(batch.preserved,1);
 const repeated:any=await mutate('personHistory:applyTestAssumptions',{societyId,testOnly:true,assignments:[batchAssignment]});assert.equal(repeated.applied,0);assert.equal(repeated.preserved,1);
 const nativeAttendanceBefore=await db.get('attendance_assumption');
 const nonPersonId=await mutate('personHistory:observe',{societyId,observation:{occurrenceKey:'fragment',recordTable:'minutes',recordId:'minute_assumption',personName:'Example Organization',context:'Attendance formatting fragment',...source}});
 await mutate('personHistory:applyTestAssumptions',{societyId,testOnly:true,assignments:[{occurrenceId:nonPersonId,status:'not_person',rationale:'Organization heading; no personal identity',source}]});
 assert.equal((await db.get(String(nonPersonId)))!.matchStatus,'not_person');assert.equal((await db.get(String(nonPersonId)))!.reviewHistory[0].testOnly,true);
 const mention={observation:{occurrenceKey:'new-context',recordTable:'minutes',recordId:'minute_assumption',personName:'Alex Example',context:'Named in discussion; attendance unknown',observedDate:'2020-06-15',meetingId:'meeting_assumption',...source},personId,rationale:'Cited discussion mentions the same full name for the interface test',note:{eventKey:'new-context-note',title:'Source discussion mention',details:'Literal source context'}};
 const staged:any=await mutate('personHistory:stageTestMentions',{societyId,testOnly:true,mentions:[mention]});assert.equal(staged.staged,1);assert.equal(staged.assumed,1);
 const stagedAgain:any=await mutate('personHistory:stageTestMentions',{societyId,testOnly:true,mentions:[mention]});assert.equal(stagedAgain.assumed,0);assert.equal(stagedAgain.results[0].occurrenceId,staged.results[0].occurrenceId);assert.equal(stagedAgain.results[0].eventId,staged.results[0].eventId);
 const note:any=await db.get(staged.results[0].eventId);assert.equal(note.reviewStatus,'pending');assert.equal(note.kind,'note');assert.deepEqual(await db.get('attendance_assumption'),nativeAttendanceBefore);
 await mutate('personHistory:reviewMatch',{...args,status:'verified',source:{...source,reviewStatus:'verified'}});
 await assert.rejects(()=>mutate('personHistory:reviewMatch',{...args,testOnly:true}),/cannot be replaced/);
 assert.equal((await db.get(String(occurrenceId)))!.reviewHistory.length,2);
 console.log(`${engine}: assumed links stay unconfirmed; history and eligibility preserved; explicit confirmation retains the trail`);
}

const api:any=anyApi;const issuer=betterAuthIssuer();
const t=convexTest(schema,{'./_generated/api.js':()=>import('../convex/_generated/api.js'),'./_generated/server.js':()=>import('../convex/_generated/server.js'),'./personHistory.js':()=>import('../convex/personHistory')} as any);
const ids=await t.run(async ctx=>{
 const societyId=await ctx.db.insert('societies',{name:'Fictional assumption test',isCharity:false,isMemberFunded:false,updatedAt:Date.now()});
 await ctx.db.insert('users',{societyId,email:'assumption-owner@example.invalid',displayName:'Owner',role:'Owner',status:'Active',authSubject:'assumption-owner',authIssuer:issuer,authProvider:'better-auth',createdAtISO:'2026-01-01'});
 const meetingId=await ctx.db.insert('meetings',{societyId,title:'Fictional meeting',scheduledAt:'2020-06-15',electronic:false,type:'Board',status:'Held',attendeeIds:[]});
 const minuteId=await ctx.db.insert('minutes',{societyId,meetingId,heldAt:'2020-06-15',attendees:['Alex Example'],absent:[],quorumMet:false,discussion:'Original',decisions:[],actionItems:[]});return {societyId,meetingId,minuteId};
});
const owner=t.withIdentity({subject:'assumption-owner',issuer});
const personId=await owner.mutation(api.personHistory.createContact,{societyId:ids.societyId,fullName:'Alex Example'});
const occurrenceId=await owner.mutation(api.personHistory.observe,{societyId:ids.societyId,observation:{occurrenceKey:'source',recordTable:'minutes',recordId:ids.minuteId,personName:'Alex Example',context:'Attendance',meetingId:ids.meetingId,...source}});
const args={societyId:ids.societyId,occurrenceId,personId,status:'assumed',rationale:'Fictional interface assumption',source,testOnly:true};
await owner.mutation(api.personHistory.reviewMatch,args);
const profile=await owner.query(api.personHistory.profile,{societyId:ids.societyId,personId});assert.equal(profile.occurrences[0].matchStatus,'assumed');assert.equal(profile.occurrences[0].reviewHistory[0].testOnly,true);
await owner.mutation(api.personHistory.reviewMatch,{...args,status:'verified',source:{...source,reviewStatus:'verified'}});
await assert.rejects(()=>owner.mutation(api.personHistory.reviewMatch,args),/cannot be replaced/);
const preserved=await owner.mutation(api.personHistory.applyTestAssumptions,{societyId:ids.societyId,testOnly:true,assignments:[{occurrenceId,personId,rationale:'Preserve confirmed source',source}]});assert.equal(preserved.preserved,1);assert.equal(preserved.applied,0);
const staged=await owner.mutation(api.personHistory.stageTestMentions,{societyId:ids.societyId,testOnly:true,mentions:[{observation:{occurrenceKey:'schema-new-mention',recordTable:'minutes',recordId:ids.minuteId,personName:'Alex Example',context:'Discussion name reference; attendance unknown',observedDate:'2020-06-15',meetingId:ids.meetingId,...source},personId,rationale:'Fictional cited context mention',note:{eventKey:'schema-new-note',title:'Source mention',details:'Literal fictional source context'}}]});assert.equal(staged.assumed,1);
const stagedProfile=await owner.query(api.personHistory.profile,{societyId:ids.societyId,personId});assert.equal(stagedProfile.events[0].reviewStatus,'pending');assert.equal(stagedProfile.events[0].testOnlyAssumption,true);
assert.equal(await t.run(async ctx=>(await ctx.db.get(ids.minuteId))!.discussion),'Original');
console.log('Convex schema and mutation: explicit assumed identity survives readback; verified source identities cannot be replaced');
