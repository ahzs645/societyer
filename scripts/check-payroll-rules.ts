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
import { emptyPayrollYtd } from "../shared/payrollDeductions";
import * as payroll from "../shared/functions/payrollCalculation";
const societyId = "rules_org",
  ownerId = "rules_owner",
  employeeId = "rules_employee";
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
const employer: EmployerSettingsFields = {
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
const profile: EmployeeProfileFields = {
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

import * as rules from "../shared/functions/payrollRules";
import { requireFunctionAction } from "../shared/functions/actionPolicy";
import {
  cloneOfficialPayrollRule,
  cleanPayrollRuleDraft,
  cleanPayrollRuleRateSet,
  payrollPercentDecimal,
  payrollPercentDisplay,
  payrollRuleCompatibility,
  payrollRuleHash,
  assertPayrollRuleApplicable,
  OFFICIAL_PAYROLL_RULE_EDITIONS,
} from "../shared/payrollRules";
import { calculatePayrollDeductions } from "../shared/payrollDeductions";
const fields = cloneOfficialPayrollRule("2026-01-BC-option1");
fields.name = "Reviewed synthetic EI correction";
fields.rateSet.ei.rate = "0.02";
fields.rateSet.ei.maximumCents = 137800;
fields.rateSet.ei.employerMaximumCents = 192920;
fields.sourceEvidence[0].notes =
  "Synthetic regression parameter edition; real deployment requires actual official evidence.";
assert.equal(payrollPercentDecimal("5.95"), "0.0595");
assert.equal(payrollPercentDisplay("0.0595"), "5.95");
for (const edition of OFFICIAL_PAYROLL_RULE_EDITIONS)
  cleanPayrollRuleRateSet(edition);
assert.throws(
  () => cleanPayrollRuleRateSet({ ...fields.rateSet, formula: "eval(gross)" }),
  /unsupported|formula/,
);
assert.throws(
  () => cleanPayrollRuleRateSet({ ...fields.rateSet, province: "ON" }),
  /British Columbia/,
);
assert.throws(
  () =>
    cleanPayrollRuleRateSet({
      ...fields.rateSet,
      ei: { ...fields.rateSet.ei, rate: "2" },
    }),
  /decimal rate/,
);
assert.throws(
  () =>
    cleanPayrollRuleRateSet({
      ...fields.rateSet,
      cpp: { ...fields.rateSet.cpp, maximumCents: 1 },
    }),
  /reconcile/,
);
assert.throws(
  () =>
    cleanPayrollRuleDraft({
      ...fields,
      sourceEvidence: [
        { ...fields.sourceEvidence[0], url: "javascript:alert(1)" },
      ],
    }),
  /HTTPS/,
);
const future = {
  ...fields.rateSet,
  year: 2027,
  effectiveFrom: "2027-01-01",
  effectiveTo: "2027-06-30",
};
cleanPayrollRuleRateSet(future);
assert.equal(payrollRuleCompatibility(future).supported, false);
assert.throws(
  () =>
    assertPayrollRuleApplicable(future, {
      payDate: "2027-05-15",
      province: "BC",
      method: "option1",
    }),
  /do not support/,
);
assert.equal(
  payrollRuleCompatibility({ ...fields.rateSet, effectiveTo: "2026-12-31" })
    .supported,
  false,
  "January policy cannot silently cover July formulas",
);
const copy = cloneOfficialPayrollRule("2026-01-BC-option1");
copy.rateSet.ei.rate = "0.99";
assert.equal(OFFICIAL_PAYROLL_RULE_EDITIONS[0].ei.rate, "0.0163");

for (const runtime of ["memory", "indexed-local"] as const) {
  const db =
    runtime === "memory"
      ? new MemoryDb({ seed: structuredClone(seed) })
      : new LocalStoreDb(
          new MemoryRowStore(structuredClone(seed), { indexed: true }),
        );
  const invoke = <T>(fn: (ctx: PortableMutationCtx) => Promise<T>) =>
    db.transaction(() => fn(tracked(db)));
  await requireFunctionAction(tracked(db), "payrollRules:saveDraft", "mutation", {
    societyId,
    baseOfficialId: "2026-01-BC-option1",
    fields,
  });
  const id = await invoke((ctx) =>
    rules.saveDraftPortable(ctx, {
      societyId,
      baseOfficialId: "2026-01-BC-option1",
      fields,
    }),
  );
  const draft = await rules.getPortable(tracked(db), { societyId, id });
  assert.equal(draft.revision, 1);
  assert.equal(draft.status, "draft");
  assert.match(draft.contentHash, /^[a-f0-9]{64}$/);
  assert.match(draft.rateSet.id, /^manual:/);
  await assert.rejects(
    () =>
      invoke((ctx) =>
        rules.publishPortable(ctx, {
          societyId,
          id,
          expectedHash: draft.contentHash,
        }),
      ),
    /Review/,
  );
  await assert.rejects(
    () =>
      rules.loadPublishedPayrollRulePortable(tracked(db), {
        societyId,
        id,
        payDate: "2026-05-15",
        province: "BC",
        method: "option1",
      }),
    /published/,
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        rules.saveDraftPortable(ctx, {
          societyId,
          id,
          expectedHash: "stale",
          fields,
        }),
      ),
    /changed/,
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        rules.reviewPortable(ctx, {
          societyId,
          id,
          expectedHash: draft.contentHash,
          evidence: "Reviewed synthetic fixture",
          confirmed: false,
        }),
      ),
    /Confirm/,
  );
  await assert.rejects(
    () => rules.getPortable(tracked(db), { societyId: "foreign", id }),
    /not found|workspace|permission|access/i,
  );
  const viewer = { ...principal, userId: "viewer" };
  await assert.rejects(
    () =>
      db.transaction(() =>
        rules.reviewPortable(tracked(db, viewer), {
          societyId,
          id,
          expectedHash: draft.contentHash,
          evidence: "Unauthorized",
          confirmed: true,
        }),
      ),
    /permission|role|Admin|financials|access|requires/i,
  );
  await invoke((ctx) =>
    rules.reviewPortable(ctx, {
      societyId,
      id,
      expectedHash: draft.contentHash,
      evidence:
        "Reviewed every synthetic parameter, cap, threshold and source against baseline",
      confirmed: true,
    }),
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        rules.saveDraftPortable(ctx, {
          societyId,
          id,
          expectedHash: draft.contentHash,
          fields,
        }),
      ),
    /immutable/,
  );
  await invoke((ctx) =>
    rules.publishPortable(ctx, {
      societyId,
      id,
      expectedHash: draft.contentHash,
    }),
  );
  const published = await rules.loadPublishedPayrollRulePortable(tracked(db), {
    societyId,
    id,
    payDate: "2026-05-15",
    province: "BC",
    method: "option1",
  });
  assert.equal(published.provenance.contentHash, draft.contentHash);
  assert.equal(published.provenance.reviewedByUserId, ownerId);
  assert.equal(published.provenance.rateSet.ei.rate, "0.02");
  await assert.rejects(
    () =>
      rules.loadPublishedPayrollRulePortable(tracked(db), {
        societyId,
        id,
        payDate: "2026-07-15",
        province: "BC",
        method: "option1",
      }),
    /cover/,
  );
  await assert.rejects(
    () =>
      rules.loadPublishedPayrollRulePortable(tracked(db), {
        societyId,
        id,
        payDate: "2026-05-15",
        province: "BC",
        method: "option2",
      }),
    /cover/,
  );
  const rateInput = {
    payDate: "2026-05-15",
    provinceOfEmployment: "BC",
    method: "option1" as const,
    payPeriodsPerYear: 24,
    periodNumber: 10,
    regular: {
      cashCents: 20000,
      taxableCents: 20000,
      pensionableCents: 20000,
      insurableCents: 20000,
    },
    ytd: emptyPayrollYtd(),
    ytdConfirmed: true,
    td1: { confirmed: true },
    cpp: { eligible: true, contributionMonths: 12 },
    ei: { exempt: false },
  };
  assert.equal(calculatePayrollDeductions(rateInput).eiEmployeeCents, 326);
  assert.equal(
    calculatePayrollDeductions(rateInput, { rateSet: published.rateSet })
      .eiEmployeeCents,
    400,
  );
  const raw = (await db.get(id, "payrollRuleEditions"))!;
  await db.transaction(() => db.patch(id, { name: "Tampered" }));
  await assert.rejects(
    () =>
      rules.loadPublishedPayrollRulePortable(tracked(db), {
        societyId,
        id,
        payDate: "2026-05-15",
        province: "BC",
        method: "option1",
      }),
    /integrity/,
  );
  await db.transaction(() => db.patch(id, { name: raw.name }));
  const secondId = await invoke((ctx) =>
    rules.saveDraftPortable(ctx, { societyId, sourceId: id, fields }),
  );
  assert.equal(
    (await rules.getPortable(tracked(db), { societyId, id: secondId }))
      .revision,
    2,
  );
  await invoke((ctx) =>
    payroll.saveEmployerSettingsPortable(ctx, { societyId, fields: employer }),
  );
  await invoke((ctx) =>
    payroll.saveProfilePortable(ctx, {
      societyId,
      employeeId,
      fields: profile,
    }),
  );
  await invoke((ctx) =>
    payroll.saveOpeningBalancePortable(ctx, {
      societyId,
      employeeId,
      fields: {
        year: 2026,
        coveredThroughDate: "2025-12-31",
        sameEmployerConfirmed: true,
        sourceReference: "Complete zero same-employer opening",
        ytd: emptyPayrollYtd(),
        insurableHours: 0,
        cashPaidCents: 0,
        netPaidCents: 0,
        vacationBalanceCents: 0,
        workSafeAssessableCents: 0,
        sickPaidDaysUsed: 0,
        sickUnpaidDaysUsed: 0,
        representedPayRunIds: [],
      },
    }),
  );
  await invoke((ctx) =>
    payroll.saveWorkDayPortable(ctx, {
      societyId,
      employeeId,
      fields: { date: "2026-05-05", minutes: 480 },
    }),
  );
  const selectedInput = { ...input, ruleEditionId: id };
  const preview = await payroll.previewPortable(tracked(db), {
    societyId,
    input: selectedInput,
  });
  assert.deepEqual(preview.blockers, []);
  assert.equal(
    preview.employees[0].deductions!.eiEmployeeCents,
    400,
    "native calculation uses the explicitly selected published edition",
  );
  assert.equal(preview.ruleEdition?.contentHash, draft.contentHash);
  assert.equal(preview.employees[0].deductions!.ruleSet.ei.rate, "0.02");
  const calculationId = await invoke((ctx) =>
    payroll.saveDraftPortable(ctx, { societyId, input: selectedInput }),
  );
  await invoke((ctx) =>
    payroll.approvePortable(ctx, { societyId, id: calculationId }),
  );
  await invoke((ctx) =>
    rules.retirePortable(ctx, {
      societyId,
      id,
      reason: "Superseded synthetic edition",
    }),
  );
  await assert.rejects(
    () =>
      rules.loadPublishedPayrollRulePortable(tracked(db), {
        societyId,
        id,
        payDate: "2026-05-15",
        province: "BC",
        method: "option1",
      }),
    /retired/,
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        payroll.finalizePortable(ctx, {
          societyId,
          id: calculationId,
          idempotencyKey: "stale-retired-rule",
        }),
      ),
    /retired|changed|published|block/i,
  );
  const frozen = await payroll.workspacePortable(tracked(db), {
    societyId,
    collection: "calculation",
    id: calculationId,
  });
  assert.equal(
    frozen.detail!.result.ruleEdition?.contentHash,
    draft.contentHash,
    "retirement never rewrites an existing calculation snapshot",
  );

  const second = await rules.getPortable(tracked(db), {
    societyId,
    id: secondId,
  });
  await invoke((ctx) =>
    rules.reviewPortable(ctx, {
      societyId,
      id: secondId,
      expectedHash: second.contentHash,
      evidence: "Reviewed unchanged rates in immutable new revision",
      confirmed: true,
    }),
  );
  await invoke((ctx) =>
    rules.publishPortable(ctx, {
      societyId,
      id: secondId,
      expectedHash: second.contentHash,
    }),
  );
  const readyId = await invoke((ctx) =>
    payroll.saveDraftPortable(ctx, {
      societyId,
      input: { ...input, ruleEditionId: secondId },
    }),
  );
  await invoke((ctx) =>
    payroll.approvePortable(ctx, { societyId, id: readyId }),
  );
  const runId = await invoke((ctx) =>
    payroll.finalizePortable(ctx, {
      societyId,
      id: readyId,
      idempotencyKey: "selected-published-rules",
      postToLedger: true,
    }),
  );
  const run = (await db.get(runId, "payRuns"))!;
  assert.equal(run.eiEmployeeCents, 400);
  assert.equal(run.eiEmployerCents, 560);
  const entries = await db.query("journalEntries").collect();
  const journal = entries.find((entry) => entry.source === "payroll_accrual")!;
  const journalLines = await db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("journalEntryId", journal._id))
    .collect();
  assert.equal(
    journalLines.reduce(
      (n, line) =>
        n + (line.side === "debit" ? line.amountCents : -line.amountCents),
      0,
    ),
    0,
    "selected-rate native ledger reconciles",
  );
  await invoke((ctx) =>
    rules.retirePortable(ctx, {
      societyId,
      id: secondId,
      reason: "Published final run remains unchanged after retirement",
    }),
  );
  const retained = await payroll.workspacePortable(tracked(db), {
    societyId,
    collection: "calculation",
    id: readyId,
  });
  assert.equal(
    retained.detail!.result.ruleEdition!.contentHash,
    second.contentHash,
  );
  assert.equal(
    retained.detail!.result.employees[0].deductions!.ruleSet.ei.rate,
    "0.02",
  );
  assert.equal((await db.get(runId, "payRuns"))!.eiEmployeeCents, 400);
  for (let i = 0; i < 41; i++)
    await invoke((ctx) =>
      rules.saveDraftPortable(ctx, {
        societyId,
        baseOfficialId: "2026-01-BC-option1",
        fields: { ...fields, name: `Paged draft ${i}` },
      }),
    );
  const first = await rules.workspacePortable(tracked(db), {
    societyId,
    status: "draft",
    year: 2026,
  });
  assert.equal(first.page.length, 40);
  assert.equal(first.isDone, false);
  const next = await rules.workspacePortable(tracked(db), {
    societyId,
    status: "draft",
    year: 2026,
    cursor: first.continueCursor,
  });
  assert.ok(next.isDone);
  assert.ok(next.page.length >= 1);
  await assert.rejects(
    () =>
      rules.workspacePortable(tracked(db), {
        societyId,
        status: "published",
        cursor: first.continueCursor,
      }),
    /does not belong/,
  );
  assert.equal(
    await payrollRuleHash({
      name: draft.name,
      rateSet: draft.rateSet,
      sourceEvidence: draft.sourceEvidence,
    }),
    draft.contentHash,
  );
  console.log(
    `${runtime}: rule lifecycle, immutability, permissions, pagination, selected native money, frozen provenance and retirement passed`,
  );
}
console.log("Versioned payroll rules checks passed");
