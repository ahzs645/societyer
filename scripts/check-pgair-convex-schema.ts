import assert from 'node:assert/strict';import {convexTest} from 'convex-test';import schema from '../convex/schema';import {api} from '../convex/_generated/api';import {betterAuthIssuer} from '../convex/lib/authIdentity';
const test=convexTest(schema,{
 './_generated/api.js':()=>import('../convex/_generated/api.js'),'./_generated/server.js':()=>import('../convex/_generated/server.js'),
 './minutesReview.js':()=>import('../convex/minutesReview'),'./memberGovernance.js':()=>import('../convex/memberGovernance'),'./financialReview.js':()=>import('../convex/financialReview'),'./insurance.js':()=>import('../convex/insurance'),'./tasks.js':()=>import('../convex/tasks'),
} as any);const issuer=betterAuthIssuer();
const ids=await test.run(async ctx=>{
 const societyId=await ctx.db.insert('societies',{name:'Synthetic hosted schema test',isCharity:false,isMemberFunded:false,updatedAt:Date.now()});
 await ctx.db.insert('users',{societyId,role:'Owner',status:'Active',email:'synthetic@example.invalid',displayName:'Synthetic tester',authSubject:'pgair-schema-test',authIssuer:issuer,authProvider:'better-auth',createdAtISO:new Date().toISOString()});
 const meetingId=await ctx.db.insert('meetings',{societyId,title:'Synthetic meeting',type:'Board',scheduledAt:'2026-01-20T19:00:00Z',electronic:false,status:'Held',attendeeIds:[]});
 const minutesId=await ctx.db.insert('minutes',{societyId,meetingId,heldAt:'2026-01-20',attendees:[],absent:[],quorumMet:false,discussion:'Synthetic',decisions:[],actionItems:[]});
 const policyId=await ctx.db.insert('insurancePolicies',{societyId,kind:'Other',insurer:'Synthetic',policyNumber:'TEST',startDate:'2025-01-01',renewalDate:'2026-01-01',status:'Active'});
 return {societyId,meetingId,minutesId,policyId};
});const actor=test.withIdentity({subject:'pgair-schema-test',issuer});const source={sourceUrl:'https://example.invalid/schema-test',sourceReference:'Synthetic test fixture',reviewStatus:'verified'};
await actor.mutation(api.minutesReview.saveEvidence,{id:ids.minutesId,evidence:{futureMeetingSuggestions:[{id:'future',date:'2026-03-01',status:'confirmed',scheduledAt:'2026-03-01T19:00:00Z',...source}]}});
await actor.mutation(api.minutesReview.scheduleSuggestions,{id:ids.minutesId,suggestionIds:['future']});
await actor.mutation(api.memberGovernance.observeSeat,{societyId:ids.societyId,seatKey:'synthetic',organizationName:'Synthetic organization',observation:{id:'observation',kind:'representative',startDate:'2022-08',...source}});
await actor.mutation(api.memberGovernance.createRule,{societyId:ids.societyId,ruleKey:'test',effectiveDate:'2025-01-01',requirements:[{id:'r',category:'orientation',label:'Synthetic rule'}],authority:source,reviewStatus:'verified'});
await actor.mutation(api.tasks.observeAction,{societyId:ids.societyId,registerKey:'Synthetic Board',externalActionId:'A-17',title:'Synthetic action',observation:{id:'a',observedDate:'2026-01-20',mappedStatus:'Done',...source}});
await actor.mutation(api.insurance.appendOperations,{id:ids.policyId,moneyEntries:[{id:'i',kind:'invoice',amountCents:280800,currency:'CAD',observedDate:'2026-01-20',...source}]});
const renewal=await actor.mutation(api.insurance.ensureRenewalTasks,{societyId:ids.societyId,asOf:'2026-01-20'});assert.equal(renewal.created,3);
const versions=await actor.query(api.financialReview.versions,{societyId:ids.societyId});assert.deepEqual(versions.statements,[]);
console.log('Hosted Convex schema and authorization accepted structured meeting, seat, rule, task and insurance writes. No live backend was used.');
