import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { tables,society } from "../src/lib/staticConvexFixtures";
import * as inv from "../shared/functions/invoices";
import {computeInvoiceTotals,convertInvoiceCents,cleanInvoiceMoney,settlementTotals,type InvoiceLine} from "../shared/invoicing";
import {ledgerBalance,accrualPostingLines,fxSettlementPostingLines} from "../shared/invoiceLedger";
const item=(price:number,rate=5,extra:Partial<InvoiceLine>={}):InvoiceLine=>({key:String(price),item:"Service",quantity:1,unitPriceCents:price,taxRatePercent:rate,taxLabel:"GST",...extra});
const inclusive=computeInvoiceTotals([item(10500)],undefined,{taxMode:"inclusive"});assert.deepEqual([inclusive.subtotalCents,inclusive.taxCents,inclusive.totalCents],[10000,500,10500]);
const mixed=computeInvoiceTotals([item(10500,5,{taxMode:"inclusive"}),item(10000,5,{taxMode:"exclusive"})]);assert.deepEqual([mixed.subtotalCents,mixed.taxCents,mixed.totalCents],[20000,1000,21000]);
for(let price=1;price<250;price++){
 const lines=[item(price,20),item(price+1,20),item(price+2,20)];const t=computeInvoiceTotals(lines,undefined,{taxMode:"inclusive"});
 assert.equal(t.totalCents,price*3+3);assert.equal(t.lineNetCents.reduce((s,n)=>s+n,0)+t.lineTaxCents.reduce((s,n)=>s+n,0),t.totalCents);
 lines.forEach((l,i)=>assert.equal(t.lineNetCents[i]+t.lineTaxCents[i],l.unitPriceCents));
 const d=computeInvoiceTotals(lines,{kind:"percent",value:10},{taxMode:"inclusive",shipping:{amountCents:13,taxRatePercent:5},withholding:{kind:"percent",value:5}});
 assert.equal(d.totalCents+d.withholdingCents,d.subtotalCents-d.discountCents+d.shippingCents+d.taxCents);
 for(const rateMicros of [750001,1333333,1500000]){
  const posting=accrualPostingLines({number:"T",billToName:"Test",lines,discount:{kind:"percent",value:10},money:{taxMode:"inclusive",shipping:{amountCents:13,taxRatePercent:5},withholding:{kind:"percent",value:5},fx:{baseCurrency:"CAD",rateMicros,asOfDate:"2026-01-01",source:"Test quote"}}},()=>"revenue",{receivableAccountId:"ar",taxPayableAccountId:"tax",withholdingAccountId:"withheld",shippingRevenueAccountId:"shipping"});assert.ok(ledgerBalance(posting).balanced);assert.ok(posting.every(l=>Number.isSafeInteger(l.amountCents)&&l.amountCents>0));
 }
}
assert.equal(convertInvoiceCents(1,1500000),2);assert.equal(convertInvoiceCents(-1,1500000),-2);assert.throws(()=>cleanInvoiceMoney({fx:{baseCurrency:"CAD",rateMicros:0,asOfDate:"2026-01-01",source:"bad"}},"USD","CAD"));
for(const [cash,book] of [[14000,13000],[12000,13000]])for(const refund of [false,true])assert.ok(ledgerBalance(fxSettlementPostingLines({amountCents:refund?-10000:10000,baseAmountCents:refund?-cash:cash,bookValueCents:refund?-book:book},{receivableAccountId:"ar",depositAccountId:"bank",gainAccountId:"gain",lossAccountId:"loss"},"settlement")).balanced);
const seed:Record<string,any[]>=JSON.parse(JSON.stringify(tables));seed.users=seed.users.map(u=>({...u,status:"Active",authIssuer:"https://issuer.test",authSubject:`sub-${u._id}`}));seed.societies=[JSON.parse(JSON.stringify(society))];
for(const table of ["invoices","invoiceCatalogItems","invoiceSettings","invoiceSeries","invoiceTemplates","invoicePriceLists","repairJobs","financialAccounts","financialTransactions","financialConnections","journalEntries","journalLines","accountingFiscalPeriods","booksSettings","repairOperations"])seed[table]=[];
const db=new MemoryDb({seed}),societyId=seed.users[0].societyId,ctx:any={db,principal:{kind:"user",runtime:"test",assurance:"trusted-workspace",subject:`sub-${seed.users[0]._id}`,issuer:"https://issuer.test",userId:seed.users[0]._id,societyId},capabilities:makeCapabilities({})};
const account=async(name:string,accountType:string,subtype?:string)=>db.insert("financialAccounts",{societyId,name,accountType,subtype,currency:"CAD"});
const ar=await account("Accounts receivable","Asset","receivable"),bank=await account("Bank","Bank"),revenue=await account("Revenue","Income"),tax=await account("GST payable","Liability","sales_tax_payable");
await inv.saveAccountMappingPortable(ctx,{societyId,receivableAccountId:ar,defaultRevenueAccountId:revenue,taxPayableAccountId:tax,depositAccountId:bank});
const today=(await inv.workspacePortable(ctx,{societyId})).today;
const quote={baseCurrency:"CAD",rateMicros:1300000,asOfDate:today,source:"Explicit agreed quote"};
const id=await inv.upsertPortable(ctx,{societyId,partyKind:"custom",billToName:"FX customer",issueDate:today,terms:"net_30",currency:"USD",money:{taxMode:"inclusive",shipping:{amountCents:1050,taxRatePercent:5,taxMode:"inclusive"},withholding:{kind:"amount",value:500},fx:quote},lines:[item(10500)]});
await inv.markSentPortable(ctx,{societyId,ids:[id]});
let row=(await db.get(id))!;assert.ok(row.journalEntryId);assert.equal(row.totalCents,11050);const originalEntry=row.journalEntryId;
const linesOf=async(entryId:string)=>db.query("journalLines").withIndex("by_entry",q=>q.eq("journalEntryId",entryId)).collect();
assert.ok(ledgerBalance(await linesOf(originalEntry) as any).balanced);
const first=await inv.recordPaymentPortable(ctx,{id,date:today,amountCents:5000,method:"cash",depositAccountId:bank,fxRateMicros:1400000,fxSource:"Actual bank rate",idempotencyKey:"first"});
assert.equal(await inv.recordPaymentPortable(ctx,{id,date:today,amountCents:5000,method:"cash",depositAccountId:bank,fxRateMicros:1400000,fxSource:"Actual bank rate",idempotencyKey:"first"}),first);
assert.equal(await inv.recordPaymentPortable(ctx,{id,date:today,amountCents:5000,method:"cash",depositAccountId:bank,fxRateMicros:1400000,fxSource:" Actual bank rate ",idempotencyKey:" first "}),first);
await assert.rejects(()=>inv.recordPaymentPortable(ctx,{id,date:today,amountCents:5000,method:"cash",depositAccountId:bank,fxRateMicros:1500000,fxSource:"Changed rate",idempotencyKey:"first"}),/different settlement/);
row=(await db.get(id))!;let p=row.payments.find((p:any)=>p.key===first);assert.equal(p.baseAmountCents,7000);assert.equal(p.fxGainLossCents,500);assert.ok(ledgerBalance(await linesOf(p.journalEntryId) as any).balanced);
await assert.rejects(()=>inv.upsertPortable(ctx,{id,societyId,partyKind:"custom",billToName:"FX customer",issueDate:today,terms:"net_30",currency:"USD",money:{...row.money,fx:{...quote,rateMicros:1400000}},lines:row.lines}),/immutable/);
const reval=await inv.revaluePortable(ctx,{id,date:today,rateMicros:1500000,source:"Period-end explicit rate",idempotencyKey:"close"});assert.ok(reval);assert.equal(await inv.revaluePortable(ctx,{id,date:today,rateMicros:1500000,source:"Period-end explicit rate",idempotencyKey:"close"}),reval);
assert.equal(await inv.revaluePortable(ctx,{id,date:today,rateMicros:1500000,source:" Period-end explicit rate ",idempotencyKey:" close "}),reval);
await assert.rejects(()=>inv.revaluePortable(ctx,{id,date:today,rateMicros:1500000,source:"Different closing source",idempotencyKey:"close"}),/another FX revaluation/);
await inv.recordPaymentPortable(ctx,{id,date:today,amountCents:6050,method:"cash",depositAccountId:bank,fxRateMicros:1200000,fxSource:"Bank settlement",idempotencyKey:"final"});
row=(await db.get(id))!;assert.equal(row.paidCents,11050);assert.ok(row.fxRevaluations.every((v:any)=>v.reversedDate===today));assert.equal((await inv.workspacePortable(ctx,{societyId})).invoices.find((r:any)=>r._id===id).status,"paid");
await inv.recordAdjustmentPortable(ctx,{id,kind:"credit",date:today,amountCents:1000,note:"Returned service credit",idempotencyKey:"credit"});
row=(await db.get(id))!;assert.equal(settlementTotals(row.payments).creditCents,1000);
await inv.recordAdjustmentPortable(ctx,{id,kind:"refund",date:today,amountCents:1000,note:"Returned cash after credit",sourcePaymentKey:first,depositAccountId:bank,fxRateMicros:1400000,fxSource:"Refund conversion",idempotencyKey:"refund"});
row=(await db.get(id))!;assert.equal(row.paidCents,11050);assert.equal(settlementTotals(row.payments).refundCents,1000);
await assert.rejects(()=>inv.recordAdjustmentPortable(ctx,{id,kind:"refund",date:today,amountCents:5000,note:"Excess refund",sourcePaymentKey:first,depositAccountId:bank,fxRateMicros:1400000,fxSource:"Refund",idempotencyKey:"badrefund"}),/exceed/);
const other=await inv.upsertPortable(ctx,{societyId,partyKind:"custom",billToName:"Write-off customer",issueDate:today,terms:"net_30",currency:"CAD",lines:[item(10000,0)]});await inv.markSentPortable(ctx,{societyId,ids:[other]});
const written=await inv.recordAdjustmentPortable(ctx,{id:other,kind:"write_off",date:today,amountCents:10000,note:"Approved uncollectible balance",idempotencyKey:"writeoff"});assert.equal((await inv.workspacePortable(ctx,{societyId})).invoices.find((r:any)=>r._id===other).status,"paid");
await inv.removePaymentPortable(ctx,{id:other,paymentKey:written});const corrected=(await db.get(other))!;assert.ok(corrected.payments[0].reversedDate);assert.equal(corrected.paidCents,0);assert.equal((await db.get(corrected.payments[0].journalEntryId))!.status,"posted");assert.ok(corrected.payments[0].reversalJournalEntryId);
assert.equal((await inv.voidInvoicesPortable(ctx,{societyId,ids:[id]})).skippedPaid,1,"Active settlements prevent voiding");
assert.equal((await inv.voidInvoicesPortable(ctx,{societyId,ids:[other]})).voided,1,"Fully reversed settlements retain history and permit a dated void");
await inv.restoreVoidedPortable(ctx,{id:other});
assert.equal((await db.get(other))!.status,"sent");
assert.equal((await db.get(other))!.payments.length,1,"Restoration preserves original settlement and reversal audit");
const tiny=await inv.upsertPortable(ctx,{societyId,partyKind:"custom",billToName:"Tiny FX refunds",issueDate:today,terms:"net_30",currency:"USD",money:{fx:{...quote,rateMicros:1500000}},lines:[item(3,0)]});
await inv.markSentPortable(ctx,{societyId,ids:[tiny]});
const tinyPayment=await inv.recordPaymentPortable(ctx,{id:tiny,date:today,amountCents:3,method:"cash",fxRateMicros:1500000,fxSource:"Tiny payment quote",idempotencyKey:"tiny-payment"});
for(let index=0;index<3;index++)await inv.recordAdjustmentPortable(ctx,{id:tiny,kind:"refund",date:today,amountCents:1,note:"Return one document-currency penny",sourcePaymentKey:tinyPayment,fxRateMicros:1500000,fxSource:"Tiny refund quote",idempotencyKey:`tiny-refund-${index}`});
const tinyRow=(await db.get(tiny))!;
assert.equal(tinyRow.payments.reduce((sum:number,payment:any)=>sum+payment.bookValueCents,0),0,"Full fragmented refunds restore exactly the original carrying value");
assert.deepEqual(tinyRow.payments.filter((payment:any)=>payment.kind==="refund").map((payment:any)=>payment.bookValueCents),[-2,-2,-1]);
await assert.rejects(()=>inv.removePaymentPortable(ctx,{id:tiny,paymentKey:tinyPayment}),/refunds first/);
await inv.revaluePortable(ctx,{id:tiny,date:today,rateMicros:1400000,source:"Revalue after tiny refunds",idempotencyKey:"tiny-revaluation"});
await inv.removePaymentPortable(ctx,{id:tiny,paymentKey:tinyRow.payments[3].key});
assert.ok((await db.get(tiny))!.fxRevaluations[0].reversedDate,"Reversing a settlement also reverses its now-outdated outstanding receivable revaluation");
const wrongCurrencyDeposit=await db.insert("financialAccounts",{societyId,name:"USD default deposit",accountType:"Bank",currency:"USD"});
await inv.saveAccountMappingPortable(ctx,{societyId,receivableAccountId:ar,defaultRevenueAccountId:revenue,taxPayableAccountId:tax,depositAccountId:wrongCurrencyDeposit});
const beforeBadDeposit=(await db.get(other))!.payments.length;
await assert.rejects(()=>inv.recordPaymentPortable(ctx,{id:other,date:today,amountCents:1,method:"cash"}),/currency must match/);
assert.equal((await db.get(other))!.payments.length,beforeBadDeposit,"An incompatible default deposit cannot write a settlement");
const wrongCurrencyTax=await db.insert("financialAccounts",{societyId,name:"USD mapped tax",accountType:"Liability",currency:"USD"});
await inv.saveAccountMappingPortable(ctx,{societyId,receivableAccountId:ar,defaultRevenueAccountId:revenue,taxPayableAccountId:wrongCurrencyTax,depositAccountId:bank});
const mismatchedTax=await inv.upsertPortable(ctx,{societyId,partyKind:"custom",billToName:"Mismatched tax mapping",issueDate:today,terms:"net_30",currency:"CAD",lines:[item(10000)]});
await inv.markSentPortable(ctx,{societyId,ids:[mismatchedTax]});
assert.equal((await db.get(mismatchedTax))!.journalEntryId,undefined,"Base amounts are never silently posted to a tax account in another currency");
assert.match((await inv.workspacePortable(ctx,{societyId})).invoices.find((row:any)=>row._id===mismatchedTax).ledger.reasons.join(" "),/Tax account.*books currency CAD/);
await inv.saveAccountMappingPortable(ctx,{societyId,receivableAccountId:ar,defaultRevenueAccountId:revenue,taxPayableAccountId:tax,depositAccountId:bank});
for(const entry of await db.query("journalEntries").withIndex("by_society",q=>q.eq("societyId",societyId)).collect())assert.ok(ledgerBalance(await linesOf(entry._id) as any).balanced,`Entry ${entry._id} balances`);
const foreignAccount=await db.insert("financialAccounts",{societyId:"other_workspace",name:"Other bank",accountType:"Bank",currency:"CAD"});await assert.rejects(()=>inv.recordPaymentPortable(ctx,{id:other,date:today,amountCents:1,method:"cash",depositAccountId:foreignAccount}));
await db.insert("accountingFiscalPeriods",{societyId,startDate:today,endDate:today,periodLabel:"Closed",status:"closed"});await assert.rejects(()=>inv.recordPaymentPortable(ctx,{id:other,date:today,amountCents:1,method:"cash",depositAccountId:bank}),/closed/i);
console.log("Invoice money checks passed: inclusive/mixed rounding, shipping, withholding, integer FX, immutable quotes, gains/losses, partial/final settlements, revaluation reversal, credits/refunds/write-offs, audit reversals, idempotency, closed periods and workspace scope.");

// Several taxes on one line, and final prices.
{
  const {solveFinalTotal}=await import("../shared/invoiceFinalPrice");
  const {decodeTaxChoice,encodeTaxChoice,INVOICE_TAX_CHOICES}=await import("../shared/invoiceMoney");
  const bc=(price:number,quantity=1,extra:Partial<InvoiceLine>={}):InvoiceLine=>({key:`bc${price}`,item:"Hall",quantity,unitPriceCents:price,...decodeTaxChoice("GST|5+PST|7"),...extra});
  const taxed=computeInvoiceTotals([bc(10000)]);
  assert.deepEqual(taxed.taxes.map(t=>[t.label,t.ratePercent,t.baseCents,t.cents]),[["GST",5,10000,500],["PST",7,10000,700]]);
  assert.equal(taxed.totalCents,11200);assert.equal(taxed.lineTaxCents[0],1200);
  const extracted=computeInvoiceTotals([bc(11200,1,{taxMode:"inclusive"})]);
  assert.deepEqual([extracted.subtotalCents,extracted.taxCents,extracted.totalCents],[10000,1200,11200]);
  assert.deepEqual(extracted.taxes.map(t=>t.cents),[500,700]);
  const mixed=computeInvoiceTotals([bc(10000),item(10000,5)]);
  assert.deepEqual(mixed.taxes.map(t=>[t.label,t.baseCents,t.cents]),[["GST",20000,1000],["PST",10000,700]]);
  assert.equal(mixed.lineTaxCents.reduce((a,b)=>a+b,0),mixed.taxCents);
  const discounted=computeInvoiceTotals([bc(10000)],{kind:"percent",value:10});
  assert.deepEqual(discounted.taxes.map(t=>t.cents),[450,630]);
  for(const choice of INVOICE_TAX_CHOICES)assert.equal(encodeTaxChoice(decodeTaxChoice(choice.value)),choice.value);
  // GST and PST round separately, so before-tax prices skip a few totals by a cent. Tax-included prices never do.
  const reachable=new Set<number>();
  for(let price=0;price<=21000;price++)reachable.add(computeInvoiceTotals([bc(price)]).grossTotalCents);
  for(let target=100;target<20000;target+=137){
    const before=solveFinalTotal([bc(0)],target)!;
    assert.equal(before.differenceCents===0,reachable.has(target),`before tax ${target}`);
    assert.ok(Math.abs(before.differenceCents)<=1,`before tax ${target}`);
    assert.equal(computeInvoiceTotals(before.lines).grossTotalCents,before.totalCents);
    const included=solveFinalTotal([bc(0,1,{taxMode:"inclusive"})],target)!;
    assert.equal(included.differenceCents,0,`tax included ${target}`);
    assert.equal(computeInvoiceTotals(included.lines).grossTotalCents,target);
  }
  const stepped=solveFinalTotal([bc(100,3)],10000)!;assert.ok(Math.abs(stepped.differenceCents)<=2);assert.equal(computeInvoiceTotals(stepped.lines).grossTotalCents,stepped.totalCents);
  // A whole invoice keeps its proportions and counts discount and shipping.
  const whole=solveFinalTotal([bc(30000),{...bc(10000),key:"b"},{...item(5000,5),key:"c"}],50000,{kind:"percent",value:10},{shipping:{amountCents:1500,taxRatePercent:5,taxLabel:"GST"}})!;
  assert.equal(whole.differenceCents,0);
  assert.ok(Math.abs(whole.lines[0].unitPriceCents/whole.lines[1].unitPriceCents-3)<0.01);
  assert.equal(solveFinalTotal([bc(1000)],1000,null,{shipping:{amountCents:5000}}),null);
  assert.equal(solveFinalTotal([],1000),null);
  console.log("Multi-tax lines and final prices verified.");
}

// Taxes remitted separately post to their own accounts, and everything built on the accrual follows.
{
  const {accrualPostingLines:accrual,unrecognisedInvoiceRevenue,taxAccountFor,normalizeTaxLabel}=await import("../shared/invoiceLedger");
  const pst=await account("PST payable","Liability","sales_tax_payable");
  const asset=await account("Not a liability","Asset");
  await assert.rejects(inv.saveAccountMappingPortable(ctx,{societyId,receivableAccountId:ar,defaultRevenueAccountId:revenue,taxPayableAccountId:tax,depositAccountId:bank,categoryAccounts:[],taxAccounts:[{taxLabel:"PST",accountId:asset}]}));
  await inv.saveAccountMappingPortable(ctx,{societyId,receivableAccountId:ar,defaultRevenueAccountId:revenue,taxPayableAccountId:tax,depositAccountId:bank,categoryAccounts:[],taxAccounts:[{taxLabel:"pst",accountId:pst},{taxLabel:"QST"}]});
  assert.deepEqual((await inv.workspacePortable(ctx,{societyId})).settings.taxAccounts,[{taxLabel:"PST",accountId:pst}]);
  assert.equal(taxAccountFor("Pst ",{taxAccounts:[{taxLabel:"PST",accountId:"p"}],taxPayableAccountId:"g"}),"p");assert.equal(normalizeTaxLabel(" gst"),"GST");
  // An earlier check closes the current period, so reopen it for this one.
  for(const period of await db.query("accountingFiscalPeriods").collect())if(period.societyId===societyId)await db.patch(period._id,{status:"open"});
  const bcInvoice=await inv.upsertPortable(ctx,{societyId,partyKind:"custom",billToName:"BC customer",issueDate:today,terms:"net_30",currency:"CAD",lines:[{item:"Hall",quantity:1,unitPriceCents:10000,taxRatePercent:5,taxLabel:"GST",additionalTaxes:[{label:"PST",ratePercent:7}]}]});
  await inv.markSentPortable(ctx,{societyId,ids:[bcInvoice]});
  const posted=(await db.get(bcInvoice))!;assert.equal(posted.totalCents,11200);assert.ok(posted.journalEntryId);
  const credited=async(entry:string,accountId:string)=>(await linesOf(entry)).filter((l:any)=>l.accountId===accountId).reduce((s:number,l:any)=>s+(l.side==="credit"?1:-1)*l.amountCents,0);
  assert.equal(await credited(posted.journalEntryId,tax),500,"GST stays on the shared account");
  assert.equal(await credited(posted.journalEntryId,pst),700,"PST lands on its own account");
  const accrued=accrual(posted,()=> "revenue",{receivableAccountId:"ar",taxPayableAccountId:"gst",taxAccounts:[{taxLabel:"PST",accountId:"pst"}]});
  const open=unrecognisedInvoiceRevenue(accrued,[],"ar");
  assert.equal(open.find((l:any)=>l.accountId==="pst")?.remainingCents,700,"cash basis recognises PST from its own account");
  assert.equal(open.find((l:any)=>l.accountId==="gst")?.remainingCents,500);
  await inv.voidInvoicesPortable(ctx,{societyId,ids:[bcInvoice],reason:"Test"});
  const entries=(await db.query("journalEntries").collect()).filter((e:any)=>e.societyId===societyId&&!["reversed","void"].includes(e.status));
  let pstBalance=0,gstBalance=0;for(const e of entries){pstBalance+=await credited(e._id,pst);}
  assert.equal(pstBalance,0,"voiding reverses PST on its own account");void gstBalance;
  await inv.saveAccountMappingPortable(ctx,{societyId,receivableAccountId:ar,defaultRevenueAccountId:revenue,taxPayableAccountId:tax,depositAccountId:bank,categoryAccounts:[],taxAccounts:[]});
  assert.equal(accrual(posted,()=> "revenue",{receivableAccountId:"ar",taxPayableAccountId:"gst"}).filter((l:any)=>l.accountId==="gst").reduce((s:number,l:any)=>s+l.amountCents,0),1200,"without a mapping both taxes use the shared account, as before");
  console.log("Separate tax accounts verified.");
}

