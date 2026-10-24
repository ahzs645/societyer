import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import type {
  EmployerSettingsFields,
  EmployeeProfileFields,
  CalculationInput,
} from "../shared/payrollCalculation";
import { payrollLocationHistory, payrollEhtReconciliation, payrollEmployeeEhtLocation } from "../shared/payrollEmployerConfiguration";
import { emptyPayrollYtd } from "../shared/payrollDeductions";
import * as payroll from "../shared/functions/payrollCalculation";
const societyId = "eht_org",
  ownerId = "eht_owner",
  employeeId = "eht_employee";
const principal = {
  kind: "user",
  runtime: "test",
  assurance: "trusted-workspace",
  subject: "native-owner",
  issuer: "https://native.test",
  userId: ownerId,
  societyId,
} as const;
const accounts = [
  ["wages", "Expense"],
  ["employer_cost", "Expense"],
  ["netpay", "Liability"],
  ["deductions", "Liability"],
  ["benefits", "Liability"],
  ["bank", "Bank"],
].map(([id, accountType]) => ({
  _id: id,
  societyId,
  name: id,
  accountType,
  currency: "CAD",
  connectionId: "connection",
  externalId: id,
  balanceCents: 0,
  isRestricted: false,
}));
const seed = {
  societies: [
    { _id: societyId, name: "Native payroll test", jurisdictionCode: "CA-BC" },
    { _id: "foreign", name: "Elsewhere" },
  ],
  users: [
    {
      _id: ownerId,
      societyId,
      role: "Owner",
      status: "Active",
      authSubject: principal.subject,
      authIssuer: principal.issuer,
    },
    { _id: "viewer", societyId, role: "Viewer", status: "Active" },
  ],
  employees: [
    {
      _id: employeeId,
      societyId,
      firstName: "Avery",
      lastName: "Worker",
      role: "Coordinator",
      startDate: "2025-02-01",
      birthDate: "1990-05-05",
      sinSecretVaultItemId: "NEVER-STORE-SIN",
      email: "NEVER-STORE-EMAIL",
      employmentType: "PartTime",
      cppExempt: false,
      eiExempt: false,
    },
    {
      _id: "foreign_employee",
      societyId: "foreign",
      firstName: "Elsewhere",
      lastName: "Person",
    },
  ],
  financialAccounts: accounts,
  payrollSettings: [
    {
      _id: "settings",
      societyId,
      remitterType: "regular",
      payrollAccountNumber: "123456789RP0001",
      updatedAtISO: "2026-01-01T00:00:00Z",
    },
  ],
  fundRestrictions: [
    { _id: "fund", societyId, name: "Student program", status: "active" },
  ],
};
const baseEmployer: EmployerSettingsFields = {
  year: 2026,
  payFrequency: "semimonthly",
  payDates: Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    return [
      `2026-${month}-15`,
      new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10),
    ];
  }).flat(),
  eiEmployerMultiplier: 1.4,
  ehtEmployerClass: "ordinary",
  ehtOpeningRemunerationCents: 0,
  ehtOpeningThroughDate: "2025-12-31",
  ehtOpeningConfirmed: true,
  ehtOpeningSourceReference: "Confirmed zero same-employer year opening",
  ehtOpeningRepresentedPayRunIds: [],
  ehtAssociated: false,
  ehtPermanentEstablishmentDays: 365,
  workSafeRatePer100Dollars: 1.2,
  workSafeAssessableLimitCents: 12750000,
  workSafeClassificationCode: "reviewed",
  workSafeRateEvidence: "Actual reviewed annual net rate",
  employerBenefitsCentsPerPay: 0,
  employerPensionPercent: 0,
  ledger: {
    wagesExpenseAccountId: "wages",
    employerExpenseAccountId: "employer_cost",
    netPayLiabilityAccountId: "netpay",
    deductionsLiabilityAccountId: "deductions",
    benefitsLiabilityAccountId: "benefits",
  },
};
const baseProfile: EmployeeProfileFields = {
  effectiveFrom: "2025-01-01",
  provinceOfEmployment: "BC",
  employmentKind: "ordinary",
  compensation: "hourly",
  rateCents: 2500,
  normalWeeklyMinutes: 2400,
  averageWeeklyMinutes: 2400,
  policy: "ordinary_bc",
  restPeriodsConfirmed: true,
  historyCompleteFrom: "2025-01-01",
  historyCompleteThrough: "2026-12-31",
  ytdConfirmed: true,
  vacationMode: "accrue",
  td1: {
    confirmed: true,
    declarationReference: "Employer recorded signed current TD1",
  },
  cpp: { exempt: false },
  eiExempt: false,
  fundingAllocations: [
    {
      label: "Student program",
      shareBps: 10000,
      fundRestrictionId: "fund",
      programCode: "STUDENT",
    },
  ],
};
const input: CalculationInput = {
  periodStart: "2026-05-01",
  periodEnd: "2026-05-15",
  payDate: "2026-05-15",
  runType: "regular",
  employeeIds: [employeeId],
  method: "option1",
};
function tracked(
  db: PortableMutationCtx["db"],
  caller: PortableMutationCtx["principal"] = principal,
) {
  let paginations = 0;
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key === "query")
        return (table: string) => {
          const query = target.query(table);
          const wrapper = new Proxy(query, {
            get(inner, method) {
              const fn = Reflect.get(inner, method);
              if (typeof fn !== "function") return fn;
              return (...args: any[]) => {
                if (method === "paginate")
                  assert.ok(++paginations <= 1, "one paginate per invocation");
                const value = fn.apply(inner, args);
                return value === inner ? wrapper : value;
              };
            },
          });
          return wrapper;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: proxy,
    principal: caller,
    capabilities: makeCapabilities({}),
  } as PortableMutationCtx;
}

const employer: EmployerSettingsFields = {
  ...baseEmployer, ehtEmployerClass: "charitable_nonprofit",
  ehtQualificationEvidence: "Reviewed Income Tax Act 149(1)(l) exemption",
  ehtOpeningRemunerationCents: 300000000,
  ehtOpeningThroughDate: "2026-04-30",
  ehtOpeningSourceReference: "Complete actual annual remuneration across both physical locations",
  ehtLocations: [
    { id: "north", evidence: "Distinct noncontiguous exclusive physical B.C. permanent establishment north", qualifying: true, openingRemunerationCents: 140000000, openingSourceReference: "Reviewed north actual payroll register" },
    { id: "south", evidence: "Distinct noncontiguous exclusive physical B.C. permanent establishment south", qualifying: true, openingRemunerationCents: 160000000, openingSourceReference: "Reviewed south actual payroll register" },
  ],
};
const profile: EmployeeProfileFields = {
  ...baseProfile, rateCents: 2500000,
  ehtLocationId: "north", ehtAttributionBasis: "primary_reporting",
  ehtAttributionEvidence: "Actual primary annual physical reporting location north",
};

for (const runtime of ["memory", "indexed-local"] as const) {
  const db = runtime === "memory" ? new MemoryDb({ seed: structuredClone(seed) }) : new LocalStoreDb(new MemoryRowStore(structuredClone(seed), { indexed: true }));
  const invoke = <T>(fn:(ctx:PortableMutationCtx)=>Promise<T>) => db.transaction(()=>fn(tracked(db)));
  await invoke(ctx=>payroll.saveEmployerSettingsPortable(ctx,{societyId,fields:employer}));
  const profileId = await invoke(ctx=>payroll.saveProfilePortable(ctx,{societyId,employeeId,fields:profile}));
  await invoke(ctx=>payroll.saveOpeningBalancePortable(ctx,{societyId,employeeId,fields:{year:2026,coveredThroughDate:"2026-04-30",sameEmployerConfirmed:true,sourceReference:"Confirmed zero employee opening; employer opening belongs to other staff",ytd:emptyPayrollYtd(),insurableHours:0,cashPaidCents:0,netPaidCents:0,vacationBalanceCents:0,workSafeAssessableCents:0,sickPaidDaysUsed:0,sickUnpaidDaysUsed:0,representedPayRunIds:[]}}));
  const workId=await invoke(ctx=>payroll.saveWorkDayPortable(ctx,{societyId,employeeId,fields:{date:"2026-05-05",minutes:480}}));
  const preview=await payroll.previewPortable(tracked(db),{societyId,input});
  assert.deepEqual(preview.blockers,[]);
  assert.deepEqual(preview.employees[0].blockers,[]);
  assert.equal(preview.totals.cashCents,20000000);
  const reconciliation=preview.ehtReconciliation!;
  assert.equal(reconciliation.complete,true);
  assert.equal(reconciliation.taxDeltaCents,292500);
  assert.deepEqual(reconciliation.locations.map(l=>[l.id,l.beforeCents,l.currentCents,l.afterCents,l.taxBeforeCents,l.taxAfterCents,l.taxDeltaCents]),[["north",140000000,20000000,160000000,0,292500,292500],["south",160000000,0,160000000,292500,292500,0]]);
  assert.equal(preview.employees[0].employerCosts!.ehtCents,292500);
  await assert.rejects(()=>invoke(ctx=>payroll.saveEmployerSettingsPortable(ctx,{societyId,fields:{...employer,ehtOpeningRemunerationCents:300000001}})),/sum|total|match|reconcile/i);
  const unqualified={...employer,ehtLocations:employer.ehtLocations!.map(l=>({...l,qualifying:false}))};
  await assert.rejects(()=>invoke(ctx=>payroll.saveEmployerSettingsPortable(ctx,{societyId,fields:unqualified})),/qualif/i);
  await assert.rejects(()=>invoke(ctx=>payroll.saveProfilePortable(ctx,{societyId,employeeId:"foreign_employee",fields:profile})),/workspace|society|not found|access/i);
  const id=await invoke(ctx=>payroll.saveDraftPortable(ctx,{societyId,input}));
  await invoke(ctx=>payroll.approvePortable(ctx,{societyId,id}));
  const runId=await invoke(ctx=>payroll.finalizePortable(ctx,{societyId,id,idempotencyKey:`eht-${runtime}`,postToLedger:true}));
  const run=(await db.get(runId,"payRuns"))!;
  assert.equal(run.lines[0].ehtLocationId,"north");
  assert.equal(run.lines[0].classifiedBases.ehtCents,20000000);
  assert.equal((await db.get(workId,"payrollWorkDays"))!.postedCalculationId,id);
  const journal=(await db.query("journalEntries").collect()).find(j=>j.source==="payroll_accrual")!;
  const lines=await db.query("journalLines").withIndex("by_entry",q=>q.eq("journalEntryId",journal._id)).collect();
  assert.equal(lines.reduce((n,l)=>n+(l.side==="debit"?l.amountCents:-l.amountCents),0),0,"allocated native ledger remains balanced including EHT");
  const fullRuns=(await db.query("payRuns").collect());
  const history=payrollLocationHistory(employer,fullRuns);
  assert.deepEqual(history.blockers,[]);
  const annual=payrollEhtReconciliation(employer,history,new Map())!;
  assert.equal(annual.locations.reduce((n,l)=>n+l.taxAfterCents,0),585000);
  assert.throws(()=>payrollEmployeeEhtLocation(employer,{...profile,ehtLocationId:"south"},history,employeeId),/annual|restate/i);
  const ambiguous=payrollLocationHistory(employer,[{_id:"old",lines:[{employeeId,classifiedBases:{ehtCents:1}}]}]);
  assert.match(ambiguous.blockers.join(" "),/unattributed/i);
  assert.equal(payrollEhtReconciliation(employer,ambiguous,new Map())!.complete,false);
  const represented=payrollLocationHistory({...employer,ehtOpeningRepresentedPayRunIds:[runId]},fullRuns);
  assert.equal(represented.before.get("north"),140000000,"reviewed opening does not double count represented runs");
  const reversalId=await invoke(ctx=>payroll.reversePortable(ctx,{societyId,id,date:"2026-05-20",reason:"Cancel unpaid boundary fixture",idempotencyKey:`eht-reversal-${runtime}`}));
  const reversal=(await db.get(reversalId,"payRuns"))!;
  assert.equal(reversal.lines[0].ehtLocationId,"north");
  assert.equal(reversal.lines[0].classifiedBases.ehtCents,-20000000);
  const reversedHistory=payrollLocationHistory(employer,await db.query("payRuns").collect());
  assert.deepEqual(reversedHistory.blockers,[]);
  assert.equal(reversedHistory.before.get("north"),140000000);
  const reversedAnnual=payrollEhtReconciliation(employer,reversedHistory,new Map())!;
  assert.equal(reversedAnnual.locations.reduce((n,l)=>n+l.taxAfterCents,0),292500);
  console.log(`${runtime}: per-location EHT save, native cents, balanced ledger, attribution, source completeness and reversal passed`);
}
console.log("Payroll multiple-location EHT checks passed");
