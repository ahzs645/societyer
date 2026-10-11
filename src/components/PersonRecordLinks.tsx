import {sourceRoleLabel} from '../../shared/personHistory';
import {peopleNamedInFragment,stripRoleAffixes} from '../../shared/personMatching';
import {useMemo,useState} from 'react';import {Link} from 'react-router-dom';import {useQuery,useMutation} from 'convex/react';import {api} from '@/lib/convexApi';import {usePermissions} from '@/hooks/usePermissions';import {useToast} from './Toast';
import {PersonPicker,useDirectoryPeople,type DirectoryPersonOption} from './PersonPicker';
import {PageErrorBoundary} from './PageErrorBoundary';

const STATUS_LABELS:Record<string,string>={verified:'Confirmed',suggested:'Suggested',unresolved:'Unresolved',assumed:'Test assumption — identity unconfirmed',rejected:'Rejected',not_person:'Organization / heading'};

/** P10: split a merged fragment into people, or create a profile from it. */
function FragmentTools({row,people}:{row:any;people:DirectoryPersonOption[]}){
 const toast=useToast();const split=useMutation(api.personHistory.splitOccurrence);const createPerson=useMutation(api.personHistory.createPersonFromOccurrence);
 const named=useMemo(()=>peopleNamedInFragment(people,[row.personName,row.roleTitle,row.affiliation].filter(Boolean).join(' ')),[people,row.personName,row.roleTitle,row.affiliation]);
 const [parts,setParts]=useState<Array<{personName:string;personId:string}>>(()=>named.length?named.map(p=>({personName:p.fullName,personId:p._id})):[{personName:stripRoleAffixes(row.personName),personId:''}]);
 const [name,setName]=useState(()=>stripRoleAffixes(row.personName));const [rationale,setRationale]=useState('');const [busy,setBusy]=useState(false);
 const run=async(action:()=>Promise<unknown>,message:string)=>{setBusy(true);try{await action();toast.success(message);}catch(e:any){toast.error(e.message);}finally{setBusy(false);}};
 return <details><summary>Split this fragment or create a person from it</summary><div className="col" style={{gap:8,marginTop:8}}>
  <p className="muted">The original wording stays as evidence. Splitting marks the fragment as a heading and adds one source occurrence per person, each still to be reviewed.</p>
  {parts.map((part,i)=><div key={i} className="row" style={{gap:8,flexWrap:'wrap'}}>
   <input className="input" aria-label={`Person ${i+1} name as written`} value={part.personName} onChange={e=>setParts(parts.map((p,j)=>j===i?{...p,personName:e.target.value}:p))} style={{flex:'1 1 180px'}}/>
   <PersonPicker people={people} value={part.personId} onChange={v=>setParts(parts.map((p,j)=>j===i?{...p,personId:v,personName:p.personName||people.find(x=>x._id===v)?.fullName||''}:p))} sourceName={part.personName} clearLabel="Leave unresolved" ariaLabel={`Person ${i+1} profile`} style={{flex:'1 1 200px'}}/>
   <button type="button" className="btn btn--ghost btn--sm" disabled={parts.length<2} onClick={()=>setParts(parts.filter((_,j)=>j!==i))}>Remove</button>
  </div>)}
  <div className="row" style={{gap:8,flexWrap:'wrap'}}><button type="button" className="btn btn--sm" onClick={()=>setParts([...parts,{personName:'',personId:''}])}>Add another person</button></div>
  <label>Rationale<input className="input" value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="What the source shows (e.g. two names run together in the attendance list)"/></label>
  <div className="row" style={{gap:8,flexWrap:'wrap'}}>
   <button className="btn" disabled={busy||!rationale.trim()||!parts.some(p=>p.personName.trim())} onClick={()=>run(()=>split({societyId:row.societyId,occurrenceId:row._id,rationale,parts:parts.filter(p=>p.personName.trim()).map(p=>({personName:p.personName.trim(),...(p.personId?{personId:p.personId}:{})}))}),'Fragment split into source occurrences')}>Split into {parts.filter(p=>p.personName.trim()).length} occurrence(s)</button>
  </div>
  <div className="row" style={{gap:8,flexWrap:'wrap',alignItems:'flex-end'}}>
   <label style={{flex:'1 1 200px'}}>New person's full name<input className="input" value={name} onChange={e=>setName(e.target.value)}/></label>
   <button className="btn" disabled={busy||!name.trim()||!rationale.trim()} onClick={()=>run(()=>createPerson({societyId:row.societyId,occurrenceId:row._id,fullName:name,rationale}),'Profile created and linked as a suggestion')}>Create profile and link</button>
  </div>
 </div></details>;
}

export function PersonOccurrenceReview({row,people}:{row:any;people:DirectoryPersonOption[]|undefined}){
 const {can}=usePermissions();const toast=useToast();const review=useMutation(api.personHistory.reviewMatch);
 const [personId,setPersonId]=useState(row.personId??'');const [rationale,setRationale]=useState('');const [busy,setBusy]=useState(false);const [open,setOpen]=useState(false);
 const submit=async(status:string)=>{setBusy(true);try{await review({societyId:row.societyId,occurrenceId:row._id,personId:personId||undefined,status,rationale,...(status==='assumed'?{testOnly:true}:{}),source:{sourceUrl:row.sourceUrl,sourceReference:row.sourceReference,reviewStatus:status==='verified'?'verified':'pending'}});toast.success(status==='assumed'?'Test assumption saved; source identity remains unconfirmed':row.personId&&personId&&personId!==row.personId?'Identity re-linked; its history moved with it':'Identity review recorded');}catch(e:any){toast.error(e.message);}finally{setBusy(false);}};
 const candidates:any[]=row.candidates??[];const named:any[]=row.namedPeople??[];
 return <div className="card__body col person-occurrence" style={{gap:8,borderBottom:'1px solid var(--border)'}}>
  <div><strong>{row.personName}</strong> · {STATUS_LABELS[row.matchStatus]??row.matchStatus} · {row.observedDate||'Date unknown'} · {row.context}</div>
  {(row.roleTitle||row.affiliation)&&<p>Source role: {sourceRoleLabel(row.roleTitle)} · Source affiliation: {row.affiliation||'Unknown'}</p>}
  {row.notes&&<p>{row.notes}</p>}
  <div className="row" style={{gap:12,flexWrap:'wrap'}}>{row.personId&&<Link to={`/app/people-directory/${row.personId}`}>Person profile {row.matchStatus==='assumed'?'(test assumption)':row.matchStatus!=='verified'?'(suggested identity)':''}</Link>}{row.href&&<Link to={row.href}>Related record</Link>}<a href={row.sourceUrl} target="_blank" rel="noreferrer">Source</a><span className="muted">{row.sourceReference}</span></div>
  {row.matchStatus==='assumed'&&<p className="muted">This link lets you explore the test interface. Confirm the cited identity before treating related history as verified.</p>}
  {row.originalRoleTitle&&row.originalRoleTitle!==row.roleTitle&&<p className="muted">Role classification checked against the original. Earlier extracted role retained for audit: {row.originalRoleTitle}</p>}
  {row.originalSourceReference&&row.originalSourceReference!==row.sourceReference&&<p className="muted">Original cell citation corrected after checking the workbook. Earlier extraction citation retained: {row.originalSourceReference}</p>}
  {candidates.length>1&&<p className="muted" role="note">Ambiguous name: {candidates.length} possible people ({candidates.slice(0,5).map(c=>c.name).join(', ')}{candidates.length>5?', …':''}). Review the source context before choosing.</p>}
  {named.length>0&&row.matchStatus==='not_person'&&<p className="muted" role="note">This fragment contains the name of {named.map(c=>c.name).join(' and ')}. It may be a person with a role or organization attached.</p>}
  {can('members:write')&&<details onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>Review person match</summary>{open&&<div className="col" style={{gap:8,marginTop:8}}>
   <label>Selected person<PersonPicker people={people} value={personId} onChange={setPersonId} sourceName={row.personName} clearLabel="Unresolved" linkedId={row.personId} ariaLabel={`Match person for ${row.personName}`}/></label>
   {row.personId&&personId&&personId!==row.personId&&<p className="muted">Re-linking moves this occurrence's history entries and contact details to the newly chosen person.</p>}
   <label>Identity rationale<input className="input" value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="How the cited source establishes this identity" /></label>
   <div className="row" style={{gap:8,flexWrap:'wrap'}}>{[['verified','Confirm match'],['unresolved','Keep unresolved'],['rejected','Reject match'],['not_person','Mark as organization / heading']].map(([status,label])=><button className="btn" key={status} disabled={busy||!rationale.trim()||(status==='verified'&&!personId)} onClick={()=>submit(status)}>{label}</button>)}</div>
   {row.matchStatus!=='verified'&&<div><button className="btn" disabled={busy||!rationale.trim()||!personId} onClick={()=>submit('assumed')}>Use as test assumption</button><p className="muted">Saves a cited, unconfirmed link for the test interface. Membership, voting rights and verified history remain separate.</p></div>}
   {people&&<FragmentTools row={row} people={people}/>}
  </div>}</details>}
  {!!row.reviewHistory?.length&&<details><summary>Identity review history ({row.reviewHistory.length})</summary>{row.reviewHistory.map((h:any,i:number)=><p key={i}>{h.reviewedAtISO} · {h.kind?`${h.kind} · `:''}{h.status} · {h.rationale} · previous {h.previous?.status??'—'}</p>)}</details>}
 </div>;
}
type PersonRecordLinksProps={societyId:string;recordTable:string;recordId:string;personName?:string;observedDate?:string;people?:DirectoryPersonOption[]};
/** P-O1: a failed lookup shows an error with Retry inside the card, never "Loading linked people…" forever. */
export function PersonRecordLinks(props:PersonRecordLinksProps){
 return <PageErrorBoundary variant="inline" subject="linked people" resetKey={`${props.societyId}|${props.recordTable}|${props.recordId}`}>
  <PersonRecordLinksPanel {...props}/>
 </PageErrorBoundary>;
}
function PersonRecordLinksPanel({societyId,recordTable,recordId,personName,observedDate,people:providedPeople}:PersonRecordLinksProps){
 const {can}=usePermissions();const toast=useToast();const read=can('members:read');
 const data=useQuery(api.personHistory.forRecord,read?{societyId,recordTable,recordId}:'skip') as any[]|undefined;
 // One light directory list (never the full occurrence overview) for the pickers.
 const loadedPeople=useDirectoryPeople(read&&!providedPeople?societyId:undefined);const people=providedPeople??loadedPeople;
 const stage=useMutation(api.personHistory.stageRecord);const observe=useMutation(api.personHistory.observe);const [sourceUrl,setUrl]=useState('');const [sourceReference,setCitation]=useState('');
 if(!read)return null;
 return <section className="card" style={{marginTop:16}}><div className="card__head"><h2 className="card__title">People linked to this record</h2><Link to="/app/people-history">Review person matches</Link></div>
  <p className="card__body muted">Identity links preserve the source wording. Test assumptions are labelled and can be confirmed or corrected here.</p>
  {data===undefined&&<p className="card__body muted">Loading linked people…</p>}
  {(data??[]).filter(row=>row.matchStatus!=='not_person').map(row=><PersonOccurrenceReview key={row._id} row={row} people={people}/>)}
  {data&&!data.some(row=>row.matchStatus!=='not_person')&&<p className="card__body muted">No person links recorded yet.</p>}
  {!!data?.some(row=>row.matchStatus==='not_person')&&<details><summary className="card__body">Source organizations and other fragments ({data.filter(row=>row.matchStatus==='not_person').length})</summary>{data.filter(row=>row.matchStatus==='not_person').map(row=><PersonOccurrenceReview key={row._id} row={row} people={people}/>)}</details>}
  {['minutes','organizationSeats'].includes(recordTable)&&can('members:write')&&<details className="card__body"><summary>Stage current source names for identity review</summary><label>Source URL<input className="input" value={sourceUrl} onChange={e=>setUrl(e.target.value)}/></label><label>Attendance / roster citation<input className="input" value={sourceReference} onChange={e=>setCitation(e.target.value)}/></label><button className="btn" disabled={!sourceUrl||!sourceReference} onClick={async()=>{try{await stage({societyId,recordTable,recordId,sourceUrl,sourceReference});toast.success('Source names staged for review');}catch(e:any){toast.error(e.message);}}}>Stage person names</button></details>}
  {personName&&can('members:write')&&data&&!data.length&&<details className="card__body"><summary>Connect this {recordTable==='members'?'member':'director'} to a person profile</summary><label>Source URL<input className="input" value={sourceUrl} onChange={e=>setUrl(e.target.value)}/></label><label>Citation<input className="input" value={sourceReference} onChange={e=>setCitation(e.target.value)}/></label><button className="btn" disabled={!sourceUrl||!sourceReference} onClick={async()=>{try{await observe({societyId,observation:{occurrenceKey:`register:${recordTable}:${recordId}`,recordTable,recordId,personName,context:'Register identity',...(observedDate?{observedDate:observedDate.slice(0,10)}:{}),sourceUrl,sourceReference}});toast.success('Register identity ready for review');}catch(e:any){toast.error(e.message);}}}>Add identity for review</button></details>}
 </section>;
}
