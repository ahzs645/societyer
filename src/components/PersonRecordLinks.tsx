import {sourceRoleLabel} from '../../shared/personHistory';
import {useState} from 'react';import {Link} from 'react-router-dom';import {useQuery,useMutation} from 'convex/react';import {api} from '@/lib/convexApi';import {usePermissions} from '@/hooks/usePermissions';import {useToast} from './Toast';
export function PersonOccurrenceReview({row,people}:{row:any;people:any[]}){
 const {can}=usePermissions();const toast=useToast();const review=useMutation(api.personHistory.reviewMatch);
 const [personId,setPersonId]=useState(row.personId??'');const [rationale,setRationale]=useState('');const [busy,setBusy]=useState(false);
 const submit=async(status:string)=>{setBusy(true);try{await review({societyId:row.societyId,occurrenceId:row._id,personId:personId||undefined,status,rationale,source:{sourceUrl:row.sourceUrl,sourceReference:row.sourceReference,reviewStatus:status==='verified'?'verified':'pending'}});toast.success('Identity review recorded');}catch(e:any){toast.error(e.message);}finally{setBusy(false);}};
 return <div className="card__body col" style={{gap:8,borderBottom:'1px solid var(--border)'}}>
  <div><strong>{row.personName}</strong> · {row.matchStatus} · {row.observedDate||'Date unknown'} · {row.context}</div>
  {(row.roleTitle||row.affiliation)&&<p>Source role: {sourceRoleLabel(row.roleTitle)} · Source affiliation: {row.affiliation||'Unknown'}</p>}
  {row.notes&&<p>{row.notes}</p>}
  <div className="row" style={{gap:12,flexWrap:'wrap'}}>{row.personId&&<Link to={`/app/people-directory/${row.personId}`}>Person profile {row.matchStatus!=='verified'?'(suggested identity)':''}</Link>}{row.href&&<Link to={row.href}>Related record</Link>}<a href={row.sourceUrl} target="_blank" rel="noreferrer">Source</a><span className="muted">{row.sourceReference}</span></div>
  {row.originalRoleTitle&&row.originalRoleTitle!==row.roleTitle&&<p className="muted">Role classification checked against the original. Earlier extracted role retained for audit: {row.originalRoleTitle}</p>}
  {row.originalSourceReference&&row.originalSourceReference!==row.sourceReference&&<p className="muted">Original cell citation corrected after checking the workbook. Earlier extraction citation retained: {row.originalSourceReference}</p>}
  {row.candidates?.length>1&&<p className="muted">Ambiguous name: {row.candidates.length} candidate profiles. Review source context before choosing.</p>}
  {can('members:write')&&<details><summary>Review person match</summary><div className="col" style={{gap:8,marginTop:8}}>
   <label>Confirmed person<select className="input" aria-label={`Match person for ${row.personName}`} value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Unresolved</option>{people.map(p=><option key={p._id} value={p._id}>{p.fullName}{p._id===row.personId?' (suggested)':''} · {String(p._id).slice(-6)}</option>)}</select></label>
   <label>Identity rationale<input className="input" value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="How the cited source establishes this identity" /></label>
   <div className="row" style={{gap:8,flexWrap:'wrap'}}>{[['verified','Confirm match'],['unresolved','Keep unresolved'],['rejected','Reject match'],['not_person','Mark as organization / heading']].map(([status,label])=><button className="btn" key={status} disabled={busy||!rationale.trim()||(status==='verified'&&!personId)} onClick={()=>submit(status)}>{label}</button>)}</div>
  </div></details>}
  {!!row.reviewHistory?.length&&<details><summary>Identity review history ({row.reviewHistory.length})</summary>{row.reviewHistory.map((h:any,i:number)=><p key={i}>{h.reviewedAtISO} · {h.status} · {h.rationale} · previous {h.previous?.status}</p>)}</details>}
 </div>;
}
export function PersonRecordLinks({societyId,recordTable,recordId,personName,observedDate}:{societyId:string;recordTable:string;recordId:string;personName?:string;observedDate?:string}){
 const {can}=usePermissions();const toast=useToast();const read=can('members:read');
 const data=useQuery(api.personHistory.forRecord,read?{societyId,recordTable,recordId}:'skip') as any[]|undefined;
 const overview=useQuery(api.personHistory.overview,read?{societyId}:'skip') as any;
 const stage=useMutation(api.personHistory.stageRecord);const observe=useMutation(api.personHistory.observe);const [sourceUrl,setUrl]=useState('');const [sourceReference,setCitation]=useState('');
 if(!read)return null;
 return <section className="card" style={{marginTop:16}}><div className="card__head"><h2 className="card__title">People linked to this record</h2><Link to="/app/people-history">Review person matches</Link></div>
  <p className="card__body muted">Identity links preserve the source wording. Suggested matches and eligibility remain subject to review.</p>
  {(data??[]).map(row=><PersonOccurrenceReview key={row._id} row={row} people={overview?.people??[]}/>)}
  {!data?.length&&<p className="card__body muted">No person links recorded yet.</p>}
  {['minutes','organizationSeats'].includes(recordTable)&&can('members:write')&&<details className="card__body"><summary>Stage current source names for identity review</summary><label>Source URL<input className="input" value={sourceUrl} onChange={e=>setUrl(e.target.value)}/></label><label>Attendance / roster citation<input className="input" value={sourceReference} onChange={e=>setCitation(e.target.value)}/></label><button className="btn" disabled={!sourceUrl||!sourceReference} onClick={async()=>{try{await stage({societyId,recordTable,recordId,sourceUrl,sourceReference});toast.success('Source names staged for review');}catch(e:any){toast.error(e.message);}}}>Stage person names</button></details>}
  {personName&&can('members:write')&&!data?.length&&<details className="card__body"><summary>Connect this {recordTable==='members'?'member':'director'} to a person profile</summary><label>Source URL<input className="input" value={sourceUrl} onChange={e=>setUrl(e.target.value)}/></label><label>Citation<input className="input" value={sourceReference} onChange={e=>setCitation(e.target.value)}/></label><button className="btn" disabled={!sourceUrl||!sourceReference} onClick={async()=>{try{await observe({societyId,observation:{occurrenceKey:`register:${recordTable}:${recordId}`,recordTable,recordId,personName,context:'Register identity',...(observedDate?{observedDate:observedDate.slice(0,10)}:{}),sourceUrl,sourceReference}});toast.success('Register identity ready for review');}catch(e:any){toast.error(e.message);}}}>Add identity for review</button></details>}
 </section>;
}
