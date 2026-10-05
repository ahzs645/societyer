import { exactDay } from './evidenceReview';
export function currentRenewalPolicies(policies:any[], asOf:string) {
  const active=policies.filter(row=>row.status==='Active'&&exactDay(row.renewalDate)&&(!row.startDate||row.startDate<=asOf));
  const current=new Map<string,any>();
  for(const row of active){const key=row.policySeriesKey||String(row._id);const before=current.get(key);if(!before||String(row.startDate??'')>String(before.startDate??'')||String(row.endDate??'')>String(before.endDate??''))current.set(key,row);}
  return [...current.values()];
}
export function insuranceBalances(entries:any[]) {
  const currencies=[...new Set(entries.map(row=>row.currency).filter(Boolean))];
  return currencies.map(currency=>{const rows=entries.filter(row=>row.currency===currency);return {currency,outstandingCents:rows.some(row=>!Number.isSafeInteger(row.amountCents))?undefined:rows.reduce((sum,row)=>sum+(row.kind==='invoice'||row.kind==='refund'?row.amountCents:row.kind==='payment'||row.kind==='credit'?-row.amountCents:0),0),claimCostCents:rows.some(row=>row.kind==='claim_cost'&&!Number.isSafeInteger(row.amountCents))?undefined:rows.filter(row=>row.kind==='claim_cost').reduce((sum,row)=>sum+row.amountCents,0),recoveryCents:rows.some(row=>row.kind==='recovery'&&!Number.isSafeInteger(row.amountCents))?undefined:rows.filter(row=>row.kind==='recovery').reduce((sum,row)=>sum+row.amountCents,0)};});
}
export function requirementResult(row:any):'met'|'not_met'|'unknown' {
  if(row.reviewStatus!=='verified'||!Number.isSafeInteger(row.requiredLimitCents)||!Number.isSafeInteger(row.confirmedLimitCents)||!row.coverageSource)return 'unknown';
  if(row.additionalInsuredRequired&&(!row.additionalInsuredVerified||!row.additionalInsuredLegalName))return row.additionalInsuredVerified===false?'not_met':'unknown';
  return row.confirmedLimitCents>=row.requiredLimitCents?'met':'not_met';
}
