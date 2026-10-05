import type {PortableMutationCtx,PortableQueryCtx} from '../portable/ctx';
import {getOwned,requireSocietyMembership} from './access';
import {requirePermissionPortable} from './permissions';
import {exactDay,partialDate,requireEvidence} from '../evidenceReview';
const TABLES=['financialStatementImports','budgetSnapshots'] as const;
export async function versions(ctx:PortableQueryCtx,{societyId}:{societyId:string}){
 await requireSocietyMembership(ctx,societyId);await requirePermissionPortable(ctx,societyId,'financials:read');
 const [statements,budgets,selections]=await Promise.all([...TABLES.map(table=>ctx.db.query(table).withIndex('by_society',q=>q.eq('societyId',societyId)).collect()),ctx.db.query('financialVersionSelections').withIndex('by_society',q=>q.eq('societyId',societyId)).collect()]);return {statements,budgets,selections};
}
export async function reviewVersion(ctx:PortableMutationCtx,args:{societyId:string;table:string;id:string;currency:string;programCode?:string;sourceIssuedDate?:string;predecessorId?:string;source:any}){
 await requirePermissionPortable(ctx,args.societyId,'financials:write');if(!TABLES.includes(args.table as any))throw new Error('Unsupported financial version table.');requireEvidence(args.source);
 const row=await getOwned(ctx,args.table,args.id,args.societyId);if(!args.currency.trim()||!partialDate(args.sourceIssuedDate))throw new Error('Version currency and source date precision must be explicit.');
 if(args.predecessorId){const prior=await getOwned(ctx,args.table,args.predecessorId,args.societyId);if(args.predecessorId===args.id||prior.fiscalYear!==row.fiscalYear)throw new Error('Invalid predecessor version.');}
 await ctx.db.patch(args.id,{currency:args.currency.toUpperCase(),programCode:args.programCode,sourceIssuedDate:args.sourceIssuedDate,predecessorId:args.predecessorId,status:args.source.reviewStatus==='verified'?'Verified':'NeedsReview',versionReviewSource:args.source});return args.id;
}
export async function selectVersion(ctx:PortableMutationCtx,args:{societyId:string;table:string;id:string;source:any}){
 await requirePermissionPortable(ctx,args.societyId,'financials:write');if(!TABLES.includes(args.table as any))throw new Error('Unsupported financial version table.');requireEvidence(args.source);
 const row=await getOwned(ctx,args.table,args.id,args.societyId);if(row.status!=='Verified'||!row.currency||args.source.reviewStatus!=='verified')throw new Error('Select a verified version with a reviewed currency.');
 const scopeKey=JSON.stringify([args.table,row.statementType??'budget',row.fiscalYear,row.periodStart??'',row.periodEnd??row.periodLabel??'',row.currency,row.programCode??'']);
 const selections=await ctx.db.query('financialVersionSelections').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect();const current=selections.find(item=>item.scopeKey===scopeKey);
 if(current?.selectedId===args.id)return current._id;
 const history=[...(current?.selectionHistory??[]),{selectedId:args.id,source:args.source,selectedAtISO:new Date().toISOString()}];
 if(current){await ctx.db.patch(current._id,{selectedId:args.id,source:args.source,selectionHistory:history,updatedAtISO:new Date().toISOString()});return current._id;}
 return ctx.db.insert('financialVersionSelections',{societyId:args.societyId,scopeKey,table:args.table,selectedId:args.id,source:args.source,selectionHistory:history,updatedAtISO:new Date().toISOString()});
}
export async function cashMovements(ctx:PortableQueryCtx,args:{societyId:string;from:string;to:string}){
 await requirePermissionPortable(ctx,args.societyId,'financials:read');if(!exactDay(args.from)||!exactDay(args.to)||args.from>args.to)throw new Error('Choose a valid date range.');
 const [accounts,entries,lines]=await Promise.all([
  ctx.db.query('financialAccounts').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect(),ctx.db.query('journalEntries').withIndex('by_society_status',q=>q.eq('societyId',args.societyId).eq('status','posted')).collect(),ctx.db.query('journalLines').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect(),
 ]);
 const accountById=new Map(accounts.map(row=>[String(row._id),row]));const cash=new Set(accounts.filter(row=>row.cashFlowClass==='cash'&&row.cashMappingReview?.reviewStatus==='verified').map(row=>String(row._id)));
 const blockers:string[]=[];if(!entries.length)blockers.push('No posted journals are available; source statements alone cannot establish cash flows.');if(!cash.size)blockers.push('Review and identify cash accounts first.');
 const totals=new Map<string,any>();
 for(const entry of entries){if(!exactDay(entry.date)){blockers.push(`Posted journal ${entry._id} has an invalid source date.`);continue;}if(entry.date>args.to)continue;
  const journal=lines.filter(row=>row.journalEntryId===entry._id);if(!journal.length){blockers.push(`Posted journal ${entry._id} has no complete lines.`);continue;}
  const balance=new Map<string,number>();let valid=true;
  for(const line of journal){const account=accountById.get(String(line.accountId));if(!account?.currency||!Number.isSafeInteger(line.amountCents)||line.amountCents<0||!['debit','credit'].includes(line.side)){valid=false;continue;}balance.set(account.currency,(balance.get(account.currency)??0)+(line.side==='debit'?line.amountCents:-line.amountCents));}
  if(!valid||[...balance.values()].some(value=>value!==0)){blockers.push(`Posted journal ${entry._id} has invalid lines or does not balance by currency.`);continue;}
  const cashLines=journal.filter(line=>cash.has(String(line.accountId)));const cashCurrency=[...new Set(cashLines.map(line=>accountById.get(String(line.accountId))!.currency))];
  for(const currency of cashCurrency){const amount=cashLines.filter(line=>accountById.get(String(line.accountId))!.currency===currency).reduce((sum,line)=>sum+(line.side==='debit'?line.amountCents:-line.amountCents),0);const total=totals.get(currency)??{currency,openingCents:0,closingCents:0,operatingCents:0,investingCents:0,financingCents:0};total.closingCents+=amount;
   if(entry.date<args.from)total.openingCents+=amount;else if(amount!==0){const classes=new Set(journal.filter(line=>!cash.has(String(line.accountId))&&accountById.get(String(line.accountId))?.currency===currency).map(line=>{const account=accountById.get(String(line.accountId))!;return account.cashMappingReview?.reviewStatus==='verified'?account.cashFlowClass:undefined;}));
    if(classes.size!==1||![...classes].every(value=>['operating','investing','financing'].includes(value)))blockers.push(`Journal ${entry._id} requires reviewed cash-flow allocations; mixed or unknown classifications cannot be inferred.`);
    else total[`${[...classes][0]}Cents`]+=amount;
   }totals.set(currency,total);
  }
 }
 for(const row of totals.values())if(row.closingCents-row.openingCents!==row.operatingCents+row.investingCents+row.financingCents)blockers.push(`${row.currency} cash movements do not tie to opening and closing cash.`);
 return {complete:blockers.length===0,blockers:[...new Set(blockers)],rows:blockers.length?[]:[...totals.values()]};
}
export async function mapCashAccount(ctx:PortableMutationCtx,args:{societyId:string;accountId:string;classification:string;source:any}){
 await requirePermissionPortable(ctx,args.societyId,'financials:write');await getOwned(ctx,'financialAccounts',args.accountId,args.societyId);requireEvidence(args.source);
 if(!['cash','operating','investing','financing'].includes(args.classification)||args.source.reviewStatus!=='verified')throw new Error('Cash mappings need a verified classification and source evidence.');
 await ctx.db.patch(args.accountId,{cashFlowClass:args.classification,cashMappingReview:args.source});return args.accountId;
}
