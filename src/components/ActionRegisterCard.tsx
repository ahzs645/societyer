import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/lib/convexApi';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { EvidenceRowsEditor } from './EvidenceRowsEditor';
export function ActionRegisterCard({societyId,tasks}:{societyId:string;tasks:any[]}) {
 const {can}=usePermissions();const toast=useToast();const observe=useMutation(api.tasks.observeAction);
 const [rows,setRows]=useState<any[]>([]);const [busy,setBusy]=useState(false);
 return <details className="card" style={{marginBottom:16}}><summary className="card__head">Rolling action register and recorded history</summary><div className="card__body col" style={{gap:12}}>
  <p className="muted">Actions reuse one task per register and external ID. Older evidence stays in history; current status comes from the latest verified exact-day observation.</p>
  {tasks.filter(row=>row.externalActionId).map(row=><details key={row._id}><summary>{row.actionRegisterKey} / {row.externalActionId}: {row.title} — current {row.status} ({row.sourceStatusDate??'unverified'})</summary>{(row.sourceObservations??[]).map((item:any)=><p key={item.id}>{item.observedDate}: recorded {item.rawStatus??'unknown'}, mapped {item.mappedStatus??'unknown'} · {item.notes} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceReference}</a></p>)}</details>)}
  <EvidenceRowsEditor title="Append source observations" rows={rows} disabled={!can('tasks:write')||busy} onChange={setRows} columns={[{key:'registerKey',label:'Register / committee'},{key:'externalActionId',label:'External action ID'},{key:'title',label:'Action title'},{key:'observedDate',label:'Source date (partial permitted)'},{key:'rawStatus',label:'Source status wording'},{key:'mappedStatus',label:'Mapped status',options:['Todo','InProgress','Blocked','Done']},{key:'reviewStatus',label:'Review',options:['pending','verified','rejected']},{key:'notes',label:'Observation notes'},{key:'sourceUrl',label:'Source URL'},{key:'sourceReference',label:'Page / table row citation'}]}/>
  <button className="btn-action" disabled={!can('tasks:write')||busy||!rows.length} onClick={async()=>{setBusy(true);try{for(const row of rows){const {registerKey,externalActionId,title,...observation}=row;await observe({societyId,registerKey,externalActionId,title,observation});}setRows([]);toast.success('Source action observations recorded');}catch(error:any){toast.error(error.message);}finally{setBusy(false);}}}>Append observations</button>
 </div></details>;
}
