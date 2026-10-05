import type {PortableMutationCtx} from '../portable/ctx';
import {getOwned} from './access';
function canonical(value:any):any { if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>!['confidence','reviewNotes','createdAtISO','updatedAtISO'].includes(key)&&value[key]!==undefined).map(key=>[key,canonical(value[key])]));return value; }
export async function importIdentity(record:any){
 const text=JSON.stringify([record.recordKind,[...(record.sourceExternalIds??[])].sort(),canonical(record.payload??{})]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const fingerprint=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 return {identity:`${record.recordKind}:${fingerprint}`,fingerprint};
}
export async function existingImportTarget(ctx:PortableMutationCtx,societyId:string,record:any){
 const {identity,fingerprint}=await importIdentity(record);
 const marker=await ctx.db.query('importTargets').withIndex('by_identity',q=>q.eq('societyId',societyId).eq('identity',identity)).first();
 if(!marker)return undefined;if(marker.payloadFingerprint!==fingerprint||marker.recordKind!==record.recordKind)throw new Error('Import identity conflict.');
 const target=await ctx.db.get(marker.targetId);if(!target||target.societyId!==societyId)throw new Error('The prior import target is missing or belongs to another workspace. Repair its source mapping before reapplying.');
 return String(marker.targetId);
}
export async function rememberImportTarget(ctx:PortableMutationCtx,societyId:string,record:any,targetId:string){
 const {identity,fingerprint}=await importIdentity(record);return ctx.db.insert('importTargets',{societyId,identity,recordKind:record.recordKind,targetId:String(targetId),payloadFingerprint:fingerprint,createdAtISO:new Date().toISOString()});
}
