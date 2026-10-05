/** Source-audit acceptance regressions: canonical targets, unknown evidence and immutable adopted records. */
import assert from 'node:assert/strict';import fs from 'node:fs';
import {MemoryDb,LocalStoreDb,MemoryRowStore,PortableRuntime,makeCapabilities} from '../shared/portable/index';
import {PORTABLE_FUNCTIONS} from '../shared/functions/registry';import {portableTestPrincipal,portableTestSeed} from './portable-test-fixture';
import {decisionReadiness,checkpointResult} from '../shared/evidenceReview';import {insuranceBalances,requirementResult} from '../shared/insuranceOperations';
const societyId='pgair_synthetic_tests';
const citation={sourceUrl:'https://example.invalid/pgair-synthetic-fixture',sourceReference:'Synthetic test fixture, not a PGAIR record',reviewStatus:'verified'};
const minuteValues={societyId,heldAt:'2026-01-20',attendees:['Synthetic attendee'],absent:[],quorumMet:false,quorumStatus:'not_met',discussion:'Original synthetic wording',decisions:[],actionItems:[]};
const seed:any={...portableTestSeed(societyId),
 meetings:[{_id:'test_meeting',societyId,title:'Synthetic Board test',type:'Board',scheduledAt:'2026-01-20T19:00:00-08:00',status:'Held',attendeeIds:[],electronic:false}],
 minutes:[{_id:'test_minutes',meetingId:'test_meeting',...minuteValues}],
 documents:[{_id:'test_document',societyId,title:'Synthetic original',category:'Test',createdAtISO:'2026-01-01T00:00:00Z',flaggedForDeletion:false,tags:[]}],
 documentVersions:[{_id:'test_version',societyId,documentId:'test_document',version:1,storageProvider:'test',storageKey:'synthetic',fileName:'test.txt',sha256:'a'.repeat(64),uploadedAtISO:'2026-01-01T00:00:00Z',isCurrent:true}],
 financialAccounts:[{_id:'test_bank',societyId,connectionId:'test_connection',externalId:'test_bank',name:'Synthetic bank',currency:'CAD',accountType:'Bank',balanceCents:0,isRestricted:false},{_id:'test_income',societyId,connectionId:'test_connection',externalId:'test_income',name:'Synthetic income',currency:'CAD',accountType:'Income',balanceCents:0,isRestricted:false}],
 financialConnections:[{_id:'test_connection',societyId,provider:'societyer',status:'connected',accountLabel:'Synthetic journal test'}],
 journalEntries:[{_id:'test_journal',societyId,date:'2026-01-20',status:'posted',entryType:'test',description:'Synthetic entry',source:'manual',updatedAtISO:'2026-01-20T00:00:00Z',createdAtISO:'2026-01-20T00:00:00Z'}],
 journalLines:[{_id:'test_debit',societyId,journalEntryId:'test_journal',accountId:'test_bank',side:'debit',amountCents:10000,currency:'CAD',createdAtISO:'2026-01-20T00:00:00Z'},{_id:'test_credit',societyId,journalEntryId:'test_journal',accountId:'test_income',side:'credit',amountCents:10000,currency:'CAD',createdAtISO:'2026-01-20T00:00:00Z'}],
 members:[{_id:'test_member',societyId,firstName:'Synthetic',lastName:'Member',membershipClass:'Test fixture',status:'Active',joinedAt:'2025-01-01',votingRights:false}],
 financialStatementImports:[{_id:'test_original_statement',societyId,title:'Synthetic original statement',fiscalYear:'2024',statementType:'balance_sheet',periodEnd:'2024-12-31',netAssetsCents:100,status:'NeedsReview',confidence:'Review',createdAtISO:'2026-01-01T00:00:00Z'},{_id:'test_revised_statement',societyId,title:'Synthetic revised statement',fiscalYear:'2024',statementType:'balance_sheet',periodEnd:'2024-12-31',netAssetsCents:200,status:'NeedsReview',confidence:'Review',createdAtISO:'2026-01-01T00:00:00Z'}],
 insurancePolicies:[{_id:'test_policy_current',societyId,kind:'GeneralLiability',insurer:'Synthetic insurer',policyNumber:'TEST-CURRENT',policySeriesKey:'test-series',startDate:'2025-01-01',endDate:'2026-01-01',renewalDate:'2026-01-01',status:'Active'},{_id:'test_policy_old',societyId,kind:'GeneralLiability',insurer:'Synthetic insurer',policyNumber:'TEST-OLD',policySeriesKey:'test-series',startDate:'2024-01-01',endDate:'2025-01-01',renewalDate:'2025-01-01',status:'Active'},{_id:'test_policy_cancelled',societyId,kind:'GeneralLiability',insurer:'Synthetic insurer',policyNumber:'TEST-CANCELLED',startDate:'2025-01-01',renewalDate:'2026-01-01',status:'Cancelled'}],
};
const groups:string[]=[];
for(const engine of ['memory','local-store']){
 const store=new MemoryRowStore(structuredClone(seed));const db=engine==='memory'?new MemoryDb({seed:structuredClone(seed)}):new LocalStoreDb(store);
 const runtime=new PortableRuntime({db,capabilities:makeCapabilities({}),principalProvider:portableTestPrincipal}).registerAll(PORTABLE_FUNCTIONS);
 const mutate=(name:string,args:any)=>runtime.runMutation(name,args);const query=(name:string,args:any)=>runtime.runQuery(name,args);
 const rows=(table:string)=>db.query(table).collect();
 // A nonzero bank/book difference and a changed posted ledger cannot close.
 const diff:any=await mutate('accounting:createReconciliationRun',{societyId,financialAccountId:'test_bank',statementDate:'2026-01-31',statementBalanceCents:536050});
 await assert.rejects(()=>mutate('accounting:setReconciliationRunStatus',{id:diff.runId,status:'reconciled'}),/difference/);
 const ready:any=await mutate('accounting:createReconciliationRun',{societyId,financialAccountId:'test_bank',statementDate:'2026-01-31',statementBalanceCents:10000});
 await db.transaction(async()=>{await db.patch('test_journal',{date:'2026-01-19'});});
 await assert.rejects(()=>mutate('accounting:setReconciliationRunStatus',{id:ready.runId,status:'reconciled'}),/changed/);
 await db.transaction(async()=>{await db.patch('test_journal',{date:'2026-01-20'});});
 // Later quorum never retroactively confirms earlier decisions. Conditions have separate dated observations.
 const checkpoints=[{id:'early',boundary:'Opening',eligibleCount:2,required:3,assertion:'not_met',...citation},{id:'later',boundary:'Item 4 after arrival',eligibleCount:3,required:3,assertion:'confirmed',...citation}];
 const decisions=[{id:'hire',title:'Synthetic conditional hiring',outcome:'Carried',checkpointId:'early',...citation}];
 const requirements=[{id:'condition1',decisionId:'hire',requirementKey:'funding',kind:'condition',state:'unknown',observedDate:'2026-01-20',...citation},{id:'ratification1',decisionId:'hire',requirementKey:'email-ratification',kind:'ratification',state:'unknown',observedDate:'2026-01-20',...citation}];
 await mutate('minutesReview:saveEvidence',{id:'test_minutes',evidence:{quorumCheckpoints:checkpoints,conditionalDecisions:decisions,decisionRequirements:requirements,consentItems:[{id:'deferred',title:'Prior minutes',outcome:'deferred',...citation}]}});
 assert.match(decisionReadiness(decisions[0],requirements,checkpoints),/quorum/);assert.equal(checkpointResult({...checkpoints[0],assertion:'confirmed'}),'conflict');
 const updatedDecision={...decisions[0],checkpointId:'later'};assert.match(decisionReadiness(updatedDecision,requirements,checkpoints),/conditions/);
 const satisfied=[...requirements,{...requirements[0],id:'condition2',state:'met',observedDate:'2026-01-21'},{...requirements[1],id:'ratification2',state:'met',observedDate:'2026-01-22'}];
 await mutate('minutesReview:saveEvidence',{id:'test_minutes',evidence:{conditionalDecisions:[updatedDecision],decisionRequirements:satisfied}});assert.equal(decisionReadiness(updatedDecision,satisfied,checkpoints),'Effective');
 await assert.rejects(()=>mutate('minutesReview:saveEvidence',{id:'test_minutes',evidence:{decisionRequirements:satisfied.slice(1)}}),/earlier/);
 // Pin exact source versions and preserve per-item deferrals.
 await assert.rejects(()=>mutate('minutesReview:saveEvidence',{id:'test_minutes',evidence:{consentItems:[{id:'unreviewed-adoption',title:'Unreviewed source',outcome:'adopted',documentVersionId:'test_version',checkpointId:'later',...citation,reviewStatus:'pending'}]}}),/verified source/);
 await mutate('minutesReview:saveEvidence',{id:'test_minutes',evidence:{consentItems:[{id:'deferred',title:'Prior minutes',outcome:'deferred',...citation},{id:'adopted',title:'Synthetic adopted document',outcome:'adopted',documentVersionId:'test_version',checkpointId:'later',...citation}]}});
 const pinned:any=await query('minutes:getByMeeting',{meetingId:'test_meeting'});assert.equal(pinned.consentItems[1].pinnedVersion.sha256,'a'.repeat(64));
 // Full future selection preflight; retries produce one target per suggestion.
 const suggestions=[{id:'future1',title:'Synthetic future meeting',date:'2026-03-18',scheduledAt:'2026-03-18T19:00:00-08:00',status:'confirmed',...citation},{id:'future2',title:'Unknown-day source suggestion',date:'2026-04',status:'confirmed',...citation}];
 await mutate('minutesReview:saveEvidence',{id:'test_minutes',evidence:{futureMeetingSuggestions:suggestions}});
 const countBefore=(await rows('meetings')).length;await assert.rejects(()=>mutate('minutesReview:scheduleSuggestions',{id:'test_minutes',suggestionIds:['future1','future2']}),/exact-day/);assert.equal((await rows('meetings')).length,countBefore);
 const ids=await mutate('minutesReview:scheduleSuggestions',{id:'test_minutes',suggestionIds:['future1']});assert.deepEqual(await mutate('minutesReview:scheduleSuggestions',{id:'test_minutes',suggestionIds:['future1']}),ids);
 // Freeze all adopted wording and export evidence; amendment preserves the preceding revision.
 await mutate('minutes:update',{id:'test_minutes',patch:{approvedAt:'2026-01-25'}});
 await assert.rejects(()=>mutate('minutes:update',{id:'test_minutes',patch:{discussion:'Rewritten after adoption'}}),/frozen/);
 await assert.rejects(()=>mutate('minutes:update',{id:'test_minutes',patch:{adoptedSnapshot:{}}}),/managed/);
 await mutate('minutes:update',{id:'test_minutes',patch:{clearApproval:true}});
 const amendment:any=await query('minutes:getByMeeting',{meetingId:'test_meeting'});assert.equal(amendment.adoptionHistory[0].snapshot.discussion,'Original synthetic wording');assert.ok(amendment.adoptionHistory[0].snapshot.futureMeetingSuggestions[0].scheduledMeetingId);
 // Register-scoped identifiers deduplicate; closure/reopening and old observations survive.
 const observe=(registerKey:string,id:string,date:string,status:string)=>mutate('tasks:observeAction',{societyId,registerKey,externalActionId:'A-17',title:'Synthetic action',observation:{id,observedDate:date,rawStatus:status,mappedStatus:status,...citation}});
 const taskId=await observe('Board','action1','2026-01-20','Done');assert.equal(await observe('Board','action1','2026-01-20','Done'),taskId);
 await observe('Board','action2','2026-01-22','InProgress');await observe('Board','action0','2026-01-19','Todo');await observe('AQMP','action3','2026-01-20','Todo');
 const action:any=await db.get(String(taskId));assert.equal(action.status,'InProgress');assert.equal(action.sourceObservations.length,3);assert.equal((await rows('tasks')).filter(row=>row.externalActionId==='A-17').length,2);
 await mutate('tasks:update',{id:taskId,patch:{status:'Done',completionNote:'Synthetic closure'}});await mutate('tasks:update',{id:taskId,patch:{status:'Todo'}});assert.equal((await db.get(String(taskId)))?.statusHistory.length,2);
 // Seats and proxies do not create ordinary members or invent succession dates.
 const memberCount=(await rows('members')).length;const seatId=await mutate('memberGovernance:observeSeat',{societyId,seatKey:'test-org-seat',organizationName:'Synthetic organization',observation:{id:'seat1',personName:'Synthetic representative',kind:'representative',startDate:'2022-08',...citation}});assert.equal((await rows('members')).length,memberCount);
 await assert.rejects(()=>mutate('memberGovernance:authorizeSeatProxy',{seatId,meetingId:'test_meeting',principalName:'Principal',proxyName:'Proxy',authority:{},source:citation}),/source/);
 await mutate('memberGovernance:authorizeSeatProxy',{seatId,meetingId:'test_meeting',principalName:'Principal',proxyName:'Proxy',authority:citation,source:citation});await assert.rejects(()=>mutate('memberGovernance:authorizeSeatProxy',{seatId,meetingId:'test_meeting',principalName:'Principal',proxyName:'Proxy two',authority:citation,source:citation}),/once|already/);
 // Missing assessments remain unknown and cannot silently change voting rights.
 const ruleId=await mutate('memberGovernance:createRule',{societyId,ruleKey:'synthetic-rule',effectiveDate:'2025-01-01',requirements:[{id:'orientation',label:'Synthetic orientation',category:'orientation'}],authority:citation,reviewStatus:'verified'});
 const assessmentId=await mutate('memberGovernance:assess',{memberId:'test_member',ruleVersionId:ruleId,asOf:'2026-01-20',results:[]});assert.equal((await db.get(String(assessmentId)))?.overall,'unknown');
 await assert.rejects(()=>mutate('memberGovernance:transition',{memberId:'test_member',assessmentId,status:'Removed',votingRights:true,source:{...citation,observedDate:'2026-01-20'}}),/satisfied/);assert.equal((await db.get('test_member'))?.votingRights,false);
 // Preserve original/revised statements and explicitly select one verified scope.
 for(const id of ['test_original_statement','test_revised_statement'])await mutate('financialReview:reviewVersion',{societyId,table:'financialStatementImports',id,currency:'CAD',sourceIssuedDate:'2025-01',source:citation});
 await mutate('financialReview:selectVersion',{societyId,table:'financialStatementImports',id:'test_original_statement',source:citation});await mutate('financialReview:selectVersion',{societyId,table:'financialStatementImports',id:'test_revised_statement',source:citation});assert.equal((await rows('financialVersionSelections')).length,1);assert.equal((await rows('financialStatementImports')).length,2);
 // Source statements alone never generate cash flow; complete mapped ledger must tie out.
 assert.equal((await query('financialReview:cashMovements',{societyId,from:'2026-01-01',to:'2026-01-31'}) as any).complete,false);
 await mutate('financialReview:mapCashAccount',{societyId,accountId:'test_bank',classification:'cash',source:citation});await mutate('financialReview:mapCashAccount',{societyId,accountId:'test_income',classification:'operating',source:citation});
 const cash:any=await query('financialReview:cashMovements',{societyId,from:'2026-01-01',to:'2026-01-31'});assert.equal(cash.complete,true);assert.equal(cash.rows[0].operatingCents,10000);assert.equal(cash.rows[0].closingCents,10000);
 // Insurance invoices/payment evidence stays separate; overdue current terms create actual deduplicated tasks.
 await mutate('insurance:appendOperations',{id:'test_policy_current',moneyEntries:[{id:'invoice',kind:'invoice',amountCents:280800,currency:'CAD',observedDate:'2025-01-01',...citation},{id:'payment',kind:'payment',amountCents:279000,currency:'CAD',observedDate:'2025-01-02',...citation}]});
 assert.equal(insuranceBalances((await db.get('test_policy_current'))!.moneyEntries)[0].outstandingCents,1800);assert.equal(requirementResult({requiredLimitCents:500000000,reviewStatus:'verified'}),'unknown');
 const renewal:any=await mutate('insurance:ensureRenewalTasks',{societyId,asOf:'2026-01-20'});assert.equal(renewal.currentDue,1);assert.equal(renewal.overdue,1);assert.equal(renewal.created,3);assert.equal((await mutate('insurance:ensureRenewalTasks',{societyId,asOf:'2026-01-20'}) as any).created,0);
 // Selected import scope and cross-session identities cannot write hidden duplicates or invent days/zeros.
 const bundle={metadata:{name:'Synthetic duplicate import'},sources:[{externalId:'google-drive:synthetic-source',title:'Synthetic source',url:citation.sourceUrl}],documentMap:[{externalId:'google-drive:synthetic-source',title:'Synthetic document',sourceExternalIds:['google-drive:synthetic-source']}]};
 for(let n=0;n<2;n++){const sessionId=await mutate('importSessions:createFromBundle',{societyId,bundle});await mutate('importSessions:bulkSetStatus',{sessionId,status:'Approved'});await mutate('importSessions:applyApprovedDocuments',{sessionId});}
 const markers=await rows('importTargets');assert.equal(markers.filter(row=>row.recordKind==='documentCandidate').length,1);
 const missing=await mutate('importSessions:createFromBundle',{societyId,bundle:{financialStatements:[{title:'Unknown totals',fiscalYear:'2024',periodEnd:'2024-12',sourceExternalIds:[]}]} });await mutate('importSessions:bulkSetStatus',{sessionId:missing,status:'Approved'});
 const invalid:any=await mutate('importSessions:applyApprovedSectionRecords',{sessionId:missing});assert.equal(invalid.total,0);assert.equal(invalid.preflightBlocked,true);assert.equal((await rows('financials')).length,0);
 if(engine==='memory'){
  const tableNames=[...new Set([...Object.keys(seed),'tasks','activity','reconciliationRuns','reconciliationRunLines','organizationSeats','seatProxyAuthorizations','membershipRuleVersions','memberAssessments','financialVersionSelections','importTargets','agendas','agendaItems','sourceEvidence'])];
  fs.mkdirSync('work/pgair-review/validation',{recursive:true});fs.writeFileSync('work/pgair-review/validation/synthetic-fixtures.json',JSON.stringify(Object.fromEntries(await Promise.all(tableNames.map(async table=>[table,await rows(table)])))));
 }
 groups.push(`${engine}: 12 workflow groups passed`);console.log(groups.at(-1));
}
fs.writeFileSync('work/pgair-review/validation/new-workflows.json',JSON.stringify({groups,passed:true,syntheticOnly:true},null,2));
