import {PersonRecordLinks} from '@/components/PersonRecordLinks';
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/lib/convexApi';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { EvidenceRowsEditor, type EvidenceColumn } from '@/components/EvidenceRowsEditor';
import { checkpointResult, decisionReadiness } from '../../../../shared/evidenceReview';
import { formatMeetingDate } from '../../../../shared/meetingDates';
const evidence: EvidenceColumn[] = [{key:'sourceExternalIds',label:'External source IDs',type:'list'},{key:'sourceUrl',label:'Source URL'},{key:'sourceReference',label:'Page / section citation'},{key:'reviewStatus',label:'Review',options:['pending','verified','rejected']}];
const editors: Record<string, {title:string;columns:EvidenceColumn[]}> = {
  consentItems: {title:'Consent adoption by document version',columns:[{key:'id',label:'Item ID'},{key:'title',label:'Document title'},{key:'documentVersionId',label:'Pinned document version ID'},{key:'targetMinutesId',label:'Target minutes ID'},{key:'outcome',label:'Recorded outcome',options:['pending','adopted','received','deferred','excluded']},{key:'checkpointId',label:'Quorum checkpoint ID'},...evidence]},
  conditionalDecisions: {title:'Conditional decisions',columns:[{key:'id',label:'Decision ID'},{key:'title',label:'Decision wording'},{key:'outcome',label:'Source outcome',options:['Carried','Deferred','Defeated','Unknown']},{key:'checkpointId',label:'Decision-time checkpoint ID'},...evidence]},
  decisionRequirements: {title:'Conditions and separate ratification observations',columns:[{key:'id',label:'Observation ID'},{key:'decisionId',label:'Decision ID'},{key:'requirementKey',label:'Requirement key (repeat for later evidence)'},{key:'title',label:'Required condition'},{key:'kind',label:'Kind',options:['condition','ratification']},{key:'state',label:'Evidence result',options:['met','not_met','unknown']},{key:'observedDate',label:'Observed day',type:'date'},...evidence]},
  attendanceEvents: {title:'Arrival, departure and proxy observations',columns:[{key:'personName',label:'Person'},{key:'kind',label:'Event',options:['present','absent','arrived','departed','proxy']},{key:'boundary',label:'Source clock time or agenda boundary'},{key:'principalName',label:'Proxy principal (when recorded)'},...evidence]},
  quorumCheckpoints: {title:'Decision-time quorum checkpoints',columns:[{key:'id',label:'Checkpoint ID'},{key:'boundary',label:'Source time or agenda boundary'},{key:'eligibleCount',label:'Present eligible count',type:'number'},{key:'eligiblePopulation',label:'Total eligible population',type:'number'},{key:'atTime',label:'Time as recorded'},{key:'scope',label:'Scope',options:['meeting','session','item']},{key:'scopeLabel',label:'Session or agenda item'},{key:'reason',label:'Reason or qualification'},{key:'evidence',label:'Source evidence'},{key:'required',label:'Historical threshold',type:'number'},{key:'assertion',label:'Source assertion',options:['confirmed','not_met','not_recorded']},...evidence]},
  futureMeetingSuggestions: {title:'Future meeting suggestions',columns:[{key:'id',label:'Suggestion ID'},{key:'title',label:'Meeting title'},{key:'committee',label:'Committee'},{key:'date',label:'Date (YYYY, YYYY-MM or YYYY-MM-DD)'},{key:'status',label:'Suggestion status',options:['tentative','tbc','confirmed']},{key:'venue',label:'Venue'},{key:'scheduledAt',label:'Reviewed time with timezone'},...evidence]},
};
/** Person links resolve every source occurrence against the whole people
 *  history (and the document library for access checks), which costs seconds
 *  on large imported workspaces. Load them on request, not with the tab (F26). */
function LazyPersonRecordLinks({societyId,recordId}:{societyId:string;recordId:string}){
  const [open,setOpen]=useState(false);
  if(open)return <PersonRecordLinks societyId={societyId} recordTable="minutes" recordId={recordId}/>;
  return <section className="card" style={{marginTop:16}}><div className="card__head"><h2 className="card__title">People linked to this record</h2><button className="btn-action" type="button" onClick={()=>setOpen(true)} data-testid="show-person-links">Show person links</button></div><p className="card__body muted">Source names matched to the people directory, with identity review. Loaded on request because it checks every source occurrence.</p></section>;
}
/** B3: consent items pick the minutes they receive or adopt instead of typing raw IDs. */
function minutesChoices(minutes: any, allMinutes: any[] | undefined, meetings: any[] | undefined) {
  const byMeeting = new Map((meetings ?? []).map((meeting: any) => [String(meeting._id), meeting]));
  return (allMinutes ?? [])
    .filter((row: any) => String(row._id) !== String(minutes?._id))
    .map((row: any) => ({ row, meeting: byMeeting.get(String(row.meetingId)) }))
    .filter(({ meeting }) => meeting)
    .sort((a: any, b: any) => String(b.meeting.scheduledAt).localeCompare(String(a.meeting.scheduledAt)))
    .map(({ row, meeting }: any) => ({ value: String(row._id), label: `${formatMeetingDate(meeting, { withTime: false })} · ${meeting.title}${row.approvedAt ? ' (approved)' : ''}` }));
}
export function MeetingEvidenceCard({minutes, allMinutes, meetings}:{minutes:any; allMinutes?: any[]; meetings?: any[]}) {
  const {can}=usePermissions();const toast=useToast();
  const save=useMutation(api.minutesReview.saveEvidence);const schedule=useMutation(api.minutesReview.scheduleSuggestions);
  const [draft,setDraft]=useState<any>(null);const [busy,setBusy]=useState(false);
  if(!minutes)return null;
  const value=draft ?? minutes;const canEdit=can('minutes:write')&&!minutes.approvedAt;
  const choices=minutesChoices(minutes,allMinutes,meetings);
  const columnsFor=(key:string)=>editors[key].columns.map(column=>key==='consentItems'&&column.key==='targetMinutesId'?{...column,label:'Minutes received / adopted',choices}:column);
  const changeRows=(key:string,rows:any[])=>setDraft({...draft,[key]:key==='consentItems'?rows.map(row=>row.targetMinutesId&&!row.outcome?{...row,outcome:'received'}:row):rows});
  return <><LazyPersonRecordLinks societyId={minutes.societyId} recordId={minutes._id}/><div className="card" style={{marginTop:16}}><div className="card__head"><h2 className="card__title">Source decisions and meeting evidence</h2>
    {canEdit&&<button className="btn-action" disabled={busy} onClick={()=>draft?setDraft(null):setDraft(Object.fromEntries(Object.keys(editors).map(key=>[key,structuredClone(minutes[key]??[])])))}>{draft?'Cancel':'Edit evidence'}</button>}
    {draft&&<button className="btn-action btn-action--primary" disabled={busy} onClick={async()=>{setBusy(true);try{await save({id:minutes._id,evidence:draft});setDraft(null);toast.success('Meeting evidence saved');}catch(error:any){toast.error(error.message);}finally{setBusy(false);}}}>Save evidence</button>}
  </div><div className="card__body col" style={{gap:12}}>
    {minutes.sourceReviewNotes&&<p className="muted">{minutes.sourceReviewNotes}</p>}
    <p className="muted">A later quorum checkpoint applies to its linked decisions. Conditions and ratifications keep their original observations. Dates and eligibility without source evidence remain unknown.</p>
    {Object.entries(editors).map(([key,editor])=><details key={key}><summary>{editor.title} ({(value[key]??[]).length})</summary><EvidenceRowsEditor title={editor.title} rows={value[key]??[]} columns={columnsFor(key)} disabled={!draft||busy} onChange={rows=>changeRows(key,rows)}/></details>)}
    {(value.quorumCheckpoints??[]).map((row:any)=><p key={row.id}>Quorum {row.id}: {checkpointResult(row)}</p>)}
    {(value.conditionalDecisions??[]).map((row:any)=><p key={row.id}>{row.title}: {decisionReadiness(row,value.decisionRequirements??[],value.quorumCheckpoints??[])}</p>)}
    {!draft&&canEdit&&can('meetings:write')&&(value.futureMeetingSuggestions??[]).length>0&&<button className="btn-action" disabled={busy} onClick={async()=>{setBusy(true);try{await schedule({id:minutes._id,suggestionIds:value.futureMeetingSuggestions.filter((row:any)=>row.status==='confirmed'&&row.reviewStatus==='verified').map((row:any)=>row.id)});toast.success('Reviewed suggestions scheduled');}catch(error:any){toast.error(error.message);}finally{setBusy(false);}}}>Schedule confirmed reviewed suggestions</button>}
  </div></div></>;
}
