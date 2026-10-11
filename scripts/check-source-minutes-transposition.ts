import assert from 'node:assert/strict';
import {MemoryDb,LocalStoreDb,MemoryRowStore,PortableRuntime,makeCapabilities} from '../shared/portable/index';
import {PORTABLE_FUNCTIONS} from '../shared/functions/registry';
import {portableTestSeed,portableTestPrincipal} from './portable-test-fixture';
import {buildSourceMinuteSections} from '../shared/sourceMinutesTransposition';

const original='Fixture AGM Script\\nDate: November 22, 2016\\n1.0 Call meeting to order\\nChair says: I declare this meeting open.\\n2.0 Adoption of Agenda\\nChair says: I MOVE approval.\\nCARRIED.\\n3.0 Appointment of directors\\n1. Alex Example, Example Organization\\n2. Sam Sample, Other Organization\\n4.0 Adjournment\\nAllow time for discussion';
const projection=buildSourceMinuteSections({minutes:{discussion:'Earlier truncated excerpt',draftTranscript:'{"sourceDocumentTitle":"AGM_Script_2016.doc"}'},agendaItems:[{title:'Sam Sample'}, {title:'Adoption of Agenda'}, {title:'Call meeting to order'}],sourceDocuments:[{_id:'source_doc',title:'AGM_Script_2016.doc',extractedText:original}]});
assert.equal(projection.sourceTransposition.sourceKind,'script');
assert.equal(projection.sourceTransposition.originalSources[0].text,original,'exact double-escaped original retained');
assert.deepEqual(projection.sections.slice(0,4).map(s=>s.title),['Call meeting to order','Adoption of Agenda','Appointment of directors','Adjournment'],'source order and no roster-as-agenda corruption');
assert.equal(projection.sections[0].depth,0,'1.0 is a root item');
assert.match(projection.sections[1].decisions![0],/^Proposed wording/);assert.equal(projection.sections[1].sourceEvidence.decisionState,'proposed');
assert.ok(projection.sourceTransposition.unmappedText.includes('November 22'));
const table='AGM minutes\n|1. |Adoption of Minutes of |Adopted prior minutes. |\n|   |2020 |Moved by Alex Example. |\n|   | |Seconded by Sam Sample, carried. |\n|2. |Financial Report |Balance $2,000 carried forward. |\n|   | |Action Item: Alex to obtain a report. |';
const recorded=buildSourceMinuteSections({minutes:{},sourceDocuments:[{title:'Fixture_minutes.doc',extractedText:table}]});
assert.equal(recorded.sections[0].title,'Adoption of Minutes of 2020');assert.match(recorded.sections[0].discussion!,/Seconded by Sam/);assert.equal(recorded.sections[1].decisions!.length,0,'carried forward is not a passed decision');assert.match(recorded.sections[1].actionItems![0].text,/Alex to obtain/);
const mixed=buildSourceMinuteSections({minutes:{},sourceDocuments:[{title:'Consent Agenda.docx',extractedText:'Agenda for November 2021\nMinutes for October 2021\nprivate package appendix',selectedText:'Minutes for October 2021\n1. Call to Order\nMeeting called to order.\n2. Approval of prior minutes\nApproved by consent.',sourceKind:'recorded_minutes',sourceReference:'Package pages 3–4, prior meeting minutes'}]});
assert.equal(mixed.sourceTransposition.sourceKind,'recorded_minutes');assert.ok(!mixed.sections.some(s=>s.discussion?.includes('private package appendix')));assert.ok(mixed.sourceTransposition.originalSources[0].text.includes('private package appendix'));

for(const engine of ['memory','local-store']) {
 const societyId='source_minute_fixture';
 const agendaBaseline=[{_id:'agenda_bad_roster',societyId,agendaId:'agenda_source',order:0,title:'Sam Sample',type:'discussion',createdAtISO:'2016-11-22'},{_id:'agenda_adoption',societyId,agendaId:'agenda_source',order:1,title:'Adoption of Agenda',type:'motion',createdAtISO:'2016-11-22'},{_id:'agenda_call',societyId,agendaId:'agenda_source',order:2,title:'Call meeting to order',type:'discussion',createdAtISO:'2016-11-22'}];
 const seed:any={...portableTestSeed(societyId),agendas:[{_id:'agenda_source',societyId,meetingId:'meeting_draft',title:'Imported agenda',status:'Draft',createdAtISO:'2016-11-22',updatedAtISO:'2016-11-22'}],agendaItems:agendaBaseline,meetings:[{_id:'meeting_draft',societyId,title:'Fictional AGM',type:'AGM',scheduledAt:'2016-11-22',electronic:false,status:'Held',attendeeIds:[]}],minutes:[{_id:'minute_draft',societyId,meetingId:'meeting_draft',heldAt:'2016-11-22',attendees:[],absent:[],quorumMet:false,discussion:'Old excerpt',sections:[],decisions:[],actionItems:[],sourceDocumentIds:['source_doc'],motionIds:['source_motion']},{_id:'minute_adopted',societyId,meetingId:'meeting_draft',discussion:'Frozen adoption',approvedAt:'2016-12-01',adoptedSnapshot:{discussion:'Frozen adoption'},sections:[]},{_id:'minute_edited',societyId,meetingId:'meeting_draft',sections:[{title:'Recorded editor notes',discussion:'Preserve my edits'}]}],documents:[{_id:'source_doc',societyId,title:'AGM_Script_2016.doc',category:'Minutes',content:JSON.stringify({extractedText:original}),createdAtISO:'2016-11-22',flaggedForDeletion:false}],motions:[{_id:'source_motion',societyId,minutesId:'minute_draft',text:'Imported scripted approval',status:'Voted',outcome:'Carried'}]};
 const db=engine==='memory'?new MemoryDb({seed}):new LocalStoreDb(new MemoryRowStore(seed));
 const runtime=new PortableRuntime({db,capabilities:makeCapabilities({}),principalProvider:portableTestPrincipal}).registerAll(PORTABLE_FUNCTIONS);
 const result:any=await runtime.runMutation('minutes:transposeSources',{societyId,entries:[{id:'minute_draft',expectedAgendaItems:structuredClone(agendaBaseline)},{id:'minute_adopted'},{id:'minute_edited'}]});
 assert.equal(result[0].sourceKind,'script');assert.equal(result[1].skipped,'adopted');assert.equal(result[2].skipped,'edited_sections');
 const saved:any=await db.get('minute_draft');
 const aligned=(await db.query('agendaItems').collect()).filter((row:any)=>row.agendaId==='agenda_source').sort((a:any,b:any)=>a.order-b.order);
 assert.deepEqual(aligned.map((row:any)=>row.title),saved.sections.map((section:any)=>section.title));
 assert.deepEqual(aligned.map((row:any)=>row._id),saved.sections.map((section:any)=>section.agendaItemId));
 assert.equal(saved.sections.find((section:any)=>section.title==='Adoption of Agenda').agendaItemId,'agenda_adoption','matched existing agenda identity survives');
 assert.equal(saved.sourceTransposition.agendaAlignment,'source_baseline_matched');assert.ok(saved.sourceTransposition.originalAgendaItems.some((row:any)=>row.title==='Sam Sample'));
 assert.ok(!await db.get('agenda_bad_roster'),'spurious roster scaffold removed from active agenda');assert.equal(saved.sourceTransposition.originalSources[0].text,original);assert.equal((await db.get('meeting_draft'))!.status,'HeldMinutesMissing');
 const motion:any=await db.get('source_motion');assert.equal(motion.status,'Draft');assert.equal(motion.outcome,undefined,'a scripted CARRIED is not a vote outcome');
 assert.equal((await runtime.runMutation('minutes:transposeSource',{id:'minute_draft'}) as any).skipped,'already_transposed');
 await assert.rejects(()=>runtime.runMutation('minutes:upsertFromDraft',{societyId,meetingId:'meeting_draft',heldAt:'2016-11-22',attendees:[],absent:[],quorumMet:false,discussion:'Replace recorded content',sections:[],motions:[],decisions:[],actionItems:[]}),/recorded content|Adopted minutes are frozen/);
 // A separately selected source must already be linked, not merely tenant-owned.
 await db.transaction(async()=>{await db.insert('minutes',{_id:'minute_unlinked',societyId,meetingId:'meeting_draft',sections:[],sourceDocumentIds:[]});});
 await assert.rejects(()=>runtime.runMutation('minutes:transposeSource',{id:'minute_unlinked',sourceSelection:[{documentId:'source_doc',selectedText:'invented'}]}),/already be linked/);
 await db.transaction(async()=>{
  await db.insert('meetings',{_id:'changed_meeting',societyId,title:'Changed agenda meeting',status:'Draft'});
  await db.insert('agendas',{_id:'changed_agenda',societyId,meetingId:'changed_meeting',title:'Edited draft agenda',status:'Draft',createdAtISO:'2026-01-01',updatedAtISO:'2026-01-01'});
  await db.insert('agendaItems',{_id:'changed_item',societyId,agendaId:'changed_agenda',order:0,title:'A person edited this topic',type:'discussion',details:'Preserve my details',createdAtISO:'2026-01-01'});
  await db.insert('minutes',{_id:'changed_minute',societyId,meetingId:'changed_meeting',sections:[],discussion:'Original short excerpt',sourceDocumentIds:['source_doc']});
 });
 await runtime.runMutation('minutes:transposeSource',{id:'changed_minute',expectedAgendaItems:[{_id:'changed_item',order:0,title:'Old source topic',type:'discussion'}]});
 assert.equal((await db.get('changed_item'))!.details,'Preserve my details');assert.equal((await db.get('changed_minute'))!.sourceTransposition.agendaAlignment,'preserved_changed_agenda');
 console.log(`✓ ${engine}: source sections, exact provenance, script outcomes, adopted/edit guards, idempotence and batch ownership`);
}
console.log('✓ Source minutes transposition contracts passed.');
