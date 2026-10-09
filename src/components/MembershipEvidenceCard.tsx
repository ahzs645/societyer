import {useEffect,useState} from 'react';import {useMutation,useQuery} from 'convex/react';import {api} from '@/lib/convexApi';import {usePermissions} from '@/hooks/usePermissions';import {useToast} from '@/components/Toast';import {Field} from './ui';import {formatDate,formatDueDate} from '../lib/format';import {EvidenceRowsEditor,type EvidenceColumn} from './EvidenceRowsEditor';
const FIELD_LABELS:Record<string,string>={ruleKey:'Rule name',effectiveDate:'Effective date (YYYY-MM-DD)',sourceUrl:'Source URL',sourceReference:'Page / section citation',assessmentId:'Assessment',status:'New membership status',observedDate:'Source date (YYYY-MM-DD)'};
const sources:EvidenceColumn[]=[{key:'sourceUrl',label:'Source URL'},{key:'sourceReference',label:'Page / section citation'}];
/** createRequest: bump to open the card on the new-rule form (used by the Members page ⋯ menu while the card is hidden). */
export function MembershipEvidenceCard({societyId,memberId,createRequest=0}:{societyId:string;memberId?:string;createRequest?:number}){
 const {can}=usePermissions(),toast=useToast();
 // Deferred panel (O-8): rules and assessments load only once the section is opened.
 const [open,setOpen]=useState(false);const [createOpen,setCreateOpen]=useState(false);
 // The register-level card stays hidden until a rule version exists, so it needs the (small) rule list up front.
 const data=useQuery(api.memberGovernance.list,open||!memberId?{societyId,...(memberId?{memberId}:{})}:'skip');
 useEffect(()=>{if(createRequest>0){setOpen(true);setCreateOpen(true);}},[createRequest]);
 const rule=useMutation(api.memberGovernance.createRule),assess=useMutation(api.memberGovernance.assess),transition=useMutation(api.memberGovernance.transition);
 const [requirements,setRequirements]=useState<any[]>([]),[results,setResults]=useState<any[]>([]);
 const [ruleForm,setRuleForm]=useState({ruleKey:'',effectiveDate:'',sourceUrl:'',sourceReference:'',reviewStatus:'pending'}),[assessment,setAssessment]=useState({ruleVersionId:'',asOf:''}),[change,setChange]=useState({assessmentId:'',status:'',sourceUrl:'',sourceReference:'',observedDate:''});const [busy,setBusy]=useState(false);
 async function run(action:()=>Promise<any>){setBusy(true);try{await action();toast.success('Membership evidence saved');}catch(error:any){toast.error(error.message);}finally{setBusy(false);}}
 const selectedRule=data?.rules.find((row:any)=>row._id===assessment.ruleVersionId);
 if(!memberId&&!open&&data&&data.rules.length===0)return null;
 return <details className="card" style={{marginBottom:16}} open={open} onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}><summary className="card__head">{memberId?'Eligibility, orientation and renewal assessments':'Membership rule versions'}</summary>{open&&<div className="card__body col" style={{gap:12}}>
 <p className="muted" style={{margin:0}}>{memberId?'Missing eligibility or renewal evidence stays unknown.':'Eligibility, orientation and renewal rules as worded on each effective date.'}</p>
 {!memberId&&<>
 <details open={createOpen} onToggle={e=>setCreateOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>New rule version</summary><div className="col" style={{gap:10}}>
 {Object.keys(ruleForm).filter(key=>key!=='reviewStatus').map(key=><Field key={key} label={FIELD_LABELS[key]??key}><input className="input" value={(ruleForm as any)[key]} onChange={e=>setRuleForm({...ruleForm,[key]:e.target.value})}/></Field>)}
 <Field label="Authority review"><select className="input" value={ruleForm.reviewStatus} onChange={e=>setRuleForm({...ruleForm,reviewStatus:e.target.value})}><option>pending</option><option>verified</option></select></Field>
 <EvidenceRowsEditor title="Configured rule requirements" rows={requirements} onChange={setRequirements} disabled={!can('members:write')||busy} columns={[{key:'label',label:'Requirement wording'},{key:'category',label:'Category',options:['eligibility','orientation','renewal']}]}/>
 <button className="btn-action" disabled={!can('members:write')||busy} onClick={()=>void run(async()=>{const {sourceUrl,sourceReference,...fields}=ruleForm;await rule({societyId,...fields,requirements,authority:{sourceUrl,sourceReference}});setRequirements([]);})}>Create rule version</button>
 </div></details></>}
 {(data?.rules??[]).map((row:any)=><p key={row._id}>{row.ruleKey} v{row.version} · effective {formatDueDate(row.effectiveDate)} · {row.reviewStatus==='verified'?'Verified':'Pending review'} · {row.requirements.map((item:any)=>item.label).join('; ')}</p>)}
 {memberId&&<>
 {(data?.assessments??[]).map((row:any)=><details key={row._id}><summary>{formatDate(row.asOf)}: {row.overall}</summary>{row.results.map((item:any)=><p key={item.id}>{item.id}: {item.state} · {item.sourceReference??'No evidence recorded'}</p>)}</details>)}
 <Field label="Historical rule version"><select className="input" value={assessment.ruleVersionId} onChange={e=>{setAssessment({...assessment,ruleVersionId:e.target.value});setResults((data?.rules.find((row:any)=>row._id===e.target.value)?.requirements??[]).map((row:any)=>({id:row.id,label:row.label,state:'unknown'})));}}><option value="">Choose a source rule</option>{(data?.rules??[]).map((row:any)=><option key={row._id} value={row._id}>{row.ruleKey} v{row.version} ({row.effectiveDate})</option>)}</select></Field>
 <Field label="Assessment day"><input className="input" type="date" value={assessment.asOf} onChange={e=>setAssessment({...assessment,asOf:e.target.value})}/></Field>
 {selectedRule&&<EvidenceRowsEditor title="Requirement assessments" rows={results} onChange={setResults} disabled={!can('members:write')||busy} columns={[{key:'id',label:'Rule requirement ID'},{key:'state',label:'Result',options:['met','not_met','unknown']},...sources]}/>}
 <button className="btn-action" disabled={!can('members:write')||busy||!selectedRule} onClick={()=>void run(async()=>{await assess({memberId,...assessment,results});})}>Record assessment</button>
 <details><summary>Explicit membership transition</summary><p className="muted">Select satisfied evidence and record the source-supported status. Voting rights keep their existing recorded value.</p>{Object.keys(change).map(key=><Field key={key} label={FIELD_LABELS[key]??key}><input className="input" value={(change as any)[key]} onChange={e=>setChange({...change,[key]:e.target.value})}/></Field>)}<button className="btn-action" disabled={!can('members:write')||busy} onClick={()=>void run(async()=>{await transition({memberId,assessmentId:change.assessmentId,status:change.status,source:{sourceUrl:change.sourceUrl,sourceReference:change.sourceReference,observedDate:change.observedDate,reviewStatus:'verified'}});})}>Apply supported membership transition</button></details>
 </>}
 </div>}</details>;
}
