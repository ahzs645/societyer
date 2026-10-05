/** Contact identity and historical observations do not establish legal membership. */
import { normalizeSearchName } from './peopleDirectory';
import { exactDay, partialDate } from './evidenceReview';
export function personNameKey(name:string) {
 const comma=name.match(/^\s*([^,]+),\s*([^,]+)$/);
 return normalizeSearchName(comma?`${comma[2]} ${comma[1]}`:name);
}
export function personCandidates(people:any[],name:string) {
 const key=personNameKey(name);
 return people.filter(p=>[p.fullName,...(p.aliases??[])].some(n=>personNameKey(n)===key));
}
export function dateBounds(value:string):[string,string] {
 if(!value||!partialDate(value))throw new Error('A source date is required (YYYY, YYYY-MM or YYYY-MM-DD).');
 if(value.length===10&&exactDay(value))return [value,value];
 if(value.length===4)return [`${value}-01-01`,`${value}-12-31`];
 const [year,month]=value.split('-').map(Number);const days=new Date(Date.UTC(year,month,0)).getUTCDate();
 return [`${value}-01`,`${value}-${days}`];
}
/** Effective events carry forward; point observations apply only to their source
 * period. Month/year changes remain uncertain inside their date boundary. */
export function personStateAt(events:any[],day:string) {
 if(!exactDay(day))throw new Error('Select an exact historical day.');
 const result:any={role:{state:'unknown',values:[]},affiliation:{state:'unknown',values:[]}};
 for(const kind of ['role','affiliation']) {
  const relevant=events.filter(e=>e.kind===kind&&e.reviewStatus==='verified');
  const scopes=new Set(relevant.map(e=>e.scope||'general'));const values:any[]=[];let uncertain=false;
  for(const scope of scopes) {
   const scoped=relevant.filter(e=>(e.scope||'general')===scope);
   const active=scoped.filter(e=>{
    const [lo,hi]=dateBounds(e.effectiveDate);if(day<lo)return false;if(day<hi){uncertain=true;return false;}
    const ends=scoped.filter(next=>next.supersedesEventId===e._id);
    for(const next of ends){const [nlo,nhi]=dateBounds(next.effectiveDate);if(day>=nlo&&day<nhi)uncertain=true;if(day>=nlo)return false;}
    if(e.endDate){const [elo,ehi]=dateBounds(e.endDate);if(day>=elo&&day<ehi)uncertain=true;if(day>=elo)return false;}
    return e.transition!=='ended';
   });
   if(active.length>1)uncertain=true;
   values.push(...active.map(e=>({value:e.value||e.title,scope,eventId:e._id,sourceUrl:e.sourceUrl,sourceReference:e.sourceReference})));
  }
  result[kind]={state:uncertain?'uncertain':values.length?'known':'unknown',values};
 }
 // Verified observations at an exact source day describe that meeting only.
 for(const kind of ['role','affiliation']){
  const field=kind==='role'?'roleTitle':'affiliation';
  const snapshots=events.filter(e=>e.reviewStatus==='verified'&&e.kind==='observation'&&e.effectiveDate===day&&e[field]);
  if(!snapshots.length)continue;
  const values=snapshots.map(e=>({value:e[field],scope:e.meetingId?`Meeting ${e.meetingId}`:e.scope,eventId:e._id,sourceUrl:e.sourceUrl,sourceReference:e.sourceReference}));
  const scopes=new Set(values.map(v=>v.scope));
  const conflict=[...scopes].some(scope=>new Set(values.filter(v=>v.scope===scope).map(v=>v.value)).size>1);
  result[kind]={state:conflict||result[kind].state==='uncertain'?'uncertain':'known',values:[...result[kind].values,...values]};
 }
 return result;
}
export const PERSON_RECORD_PERMISSIONS:Record<string,string>={
 minutes:'minutes',meetings:'meetings',organizationSeats:'members',members:'members',directors:'directors',
 boardRoleAssignments:'directors',boardRoleChanges:'directors',meetingAttendanceRecords:'meetings',
 documents:'documents',motions:'motions',tasks:'tasks',notes:'tasks',memberHistoryEvents:'members',
};
export function personRecordHref(row:any) {
 if(row.meetingId)return `/app/meetings/${row.meetingId}?tab=minutes`;
 if(row.recordTable==='members')return `/app/members/${row.recordId}`;
 if(row.recordTable==='directors')return '/app/directors';
 if(row.recordTable==='tasks')return '/app/tasks';
 if(row.documentId||row.recordTable==='documents')return `/app/documents/${row.documentId||row.recordId}`;
 return '/app/members';
}

export function sourceRoleLabel(value?:string){return !value||["?","-","n/a"].includes(value.toLowerCase())?"Unknown":value&&/^[+()\d\s.-]{7,}$/.test(value)?"Unknown (Office cell contains a phone number)":value||"Unknown";}
