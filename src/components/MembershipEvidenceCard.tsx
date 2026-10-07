import {useState} from 'react';import {useMutation,useQuery} from 'convex/react';import {api} from '@/lib/convexApi';import {usePermissions} from '@/hooks/usePermissions';import {useToast} from '@/components/Toast';import {Field} from './ui';import {EvidenceRowsEditor,type EvidenceColumn} from './EvidenceRowsEditor';
const sources:EvidenceColumn[]=[{key:'sourceUrl',label:'Source URL'},{key:'sourceReference',label:'Page / section citation'}];
export function MembershipEvidenceCard({societyId,memberId}:{societyId:string;memberId?:string}){
 const {can}=usePermissions(),toast=useToast();
 // Deferred panel (O-8): rules and assessments load only once the section is opened.
 const [open,setOpen]=useState(false);const data=useQuery(api.memberGovernance.list,open?{societyId,...(memberId?{memberId}:{})}:'skip');
 const rule=useMutation(api.memberGovernance.createRule),assess=useMutation(api.memberGovernance.assess),transition=useMutation(api.memberGovernance.transition);
 const [requirements,setRequirements]=useState<any[]>([]),[results,setResults]=useState<any[]>([]);
 const [ruleForm,setRuleForm]=useState({ruleKey:'',effectiveDate:'',sourceUrl:'',sourceReference:'',reviewStatus:'pending'}),[assessment,setAssessment]=useState({ruleVersionId:'',asOf:''}),[change,setChange]=useState({assessmentId:'',status:'',sourceUrl:'',sourceReference:'',observedDate:''});const [busy,setBusy]=useState(false);
 async function run(action:()=>Promise<any>){setBusy(true);try{await action();toast.success('Membership evidence saved');}catch(error:any){toast.error(error.message);}finally{setBusy(false);}}
 const selectedRule=data?.rules.find((row:any)=>row._id===assessment.ruleVersionId);
 return <details className="card" style={{marginBottom:16}} open={open} onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}><summary className="card__head">{memberId?'Eligibility, orientation and renewal assessments':'Membership rule versions'}</summary>{open&&<div className="card__body col" style={{gap:12}}>
 <p className="muted">{memberId?'Missing eligibility or renewal evidence remains unknown. Register transitions require an explicit supported change.':'Eligibility, orientation and renewal rules as the bylaws or policies stated them on each effective date. Organization members, seats and proxies are under Members & representatives.'}</p>
 {!memberId&&<>
 <details><summary>Create an immutable rule version</summary><div className="col" style={{gap:10}}>
 {Object.keys(ruleForm).filter(key=>key!=='reviewStatus').map(key=><Field key={key} label={key}><input className="input" value={(ruleForm as any)[key]} onChange={e=>setRuleForm({...ruleForm,[key]:e.target.value})}/></Field>)}
 <Field label="Authority review"><select className="input" value={ruleForm.reviewStatus} onChange={e=>setRuleForm({...ruleForm,reviewStatus:e.target.value})}><option>pending</option><option>verified</option></select></Field>
 <EvidenceRowsEditor title="Configured rule requirements" rows={requirements} onChange={setRequirements} disabled={!can('members:write')||busy} columns={[{key:'label',label:'Requirement wording'},{key:'category',label:'Category',options:['eligibility','orientation','renewal']}]}/>
 <button className="btn-action" disabled={!can('members:write')||busy} onClick={()=>void run(async()=>{const {sourceUrl,sourceReference,...fields}=ruleForm;await rule({societyId,...fields,requirements,authority:{sourceUrl,sourceReference}});setRequirements([]);})}>Create rule version</button>
 </div></details></>}
 {(data?.rules??[]).map((row:any)=><p key={row._id}>{row.ruleKey} v{row.version} · effective {row.effectiveDate} · {row.reviewStatus} · {row.requirements.map((item:any)=>item.label).join('; ')}</p>)}
 {memberId&&<>
 {(data?.assessments??[]).map((row:any)=><details key={row._id}><summary>{row.asOf}: {row.overall} ({row._id})</summary>{row.results.map((item:any)=><p key={item.id}>{item.id}: {item.state} · {item.sourceReference??'No evidence recorded'}</p>)}</details>)}
 <Field label="Historical rule version"><select className="input" value={assessment.ruleVersionId} onChange={e=>{setAssessment({...assessment,ruleVersionId:e.target.value});setResults((data?.rules.find((row:any)=>row._id===e.target.value)?.requirements??[]).map((row:any)=>({id:row.id,label:row.label,state:'unknown'})));}}><option value="">Choose a source rule</option>{(data?.rules??[]).map((row:any)=><option key={row._id} value={row._id}>{row.ruleKey} v{row.version} ({row.effectiveDate})</option>)}</select></Field>
 <Field label="Assessment day"><input className="input" type="date" value={assessment.asOf} onChange={e=>setAssessment({...assessment,asOf:e.target.value})}/></Field>
 {selectedRule&&<EvidenceRowsEditor title="Requirement assessments" rows={results} onChange={setResults} disabled={!can('members:write')||busy} columns={[{key:'id',label:'Rule requirement ID'},{key:'state',label:'Result',options:['met','not_met','unknown']},...sources]}/>}
 <button className="btn-action" disabled={!can('members:write')||busy||!selectedRule} onClick={()=>void run(async()=>{await assess({memberId,...assessment,results});})}>Record assessment</button>
 <details><summary>Explicit membership transition</summary><p className="muted">Select satisfied evidence and record the source-supported status. Voting rights keep their existing recorded value.</p>{Object.keys(change).map(key=><Field key={key} label={key}><input className="input" value={(change as any)[key]} onChange={e=>setChange({...change,[key]:e.target.value})}/></Field>)}<button className="btn-action" disabled={!can('members:write')||busy} onClick={()=>void run(async()=>{await transition({memberId,assessmentId:change.assessmentId,status:change.status,source:{sourceUrl:change.sourceUrl,sourceReference:change.sourceReference,observedDate:change.observedDate,reviewStatus:'verified'}});})}>Apply supported membership transition</button></details>
 </>}
 </div>}</details>;
}
