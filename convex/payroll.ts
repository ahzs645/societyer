import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  payrollWorkspacePortable,
  payrollSaveSettingsPortable,
  payrollSavePayRunPortable,
  payrollImportPayRunsPortable,
  payrollRemovePayRunPortable,
  payrollRecordRemittancePortable,
  payrollSaveSlipPortable,
  payrollGenerateSlipsPortable,
  payrollRemoveSlipPortable,
  payrollSaveRoePortable,
  payrollRemoveRoePortable,
  payrollSyncDeadlinesPortable,
} from "../shared/functions/businessRegisters";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { payRunLineValidator } from "./tables/businessRegisters";

// Payroll register: record-keeping for pay runs, CRA remittances, year-end
// slips and records of employment. Nothing here runs payroll or pays the CRA.

const amountArgs = {
  grossCents: v.optional(v.number()),
  nonCashTaxableCents: v.optional(v.number()),
  nonTaxableCashCents: v.optional(v.number()),
  cppEmployeeCents: v.optional(v.number()),
  cpp2EmployeeCents: v.optional(v.number()),
  eiEmployeeCents: v.optional(v.number()),
  incomeTaxCents: v.optional(v.number()),
  federalTaxCents: v.optional(v.number()), provincialTaxCents: v.optional(v.number()), additionalIncomeTaxCents: v.optional(v.number()),
  otherDeductionsCents: v.optional(v.number()),
  cppEmployerCents: v.optional(v.number()),
  cpp2EmployerCents: v.optional(v.number()),
  eiEmployerCents: v.optional(v.number()),
  netCents: v.optional(v.number()),
};

const payRunArgs = {
  periodStart: v.string(),
  periodEnd: v.string(),
  payDate: v.string(),
  ...amountArgs,
  lines: v.optional(v.array(payRunLineValidator)),
  clearLines: v.optional(v.boolean()),
  providerName: v.optional(v.string()),
  providerRunId: v.optional(v.string()),
  runType: v.optional(v.string()),
  correctsRunId: v.optional(v.id("payRuns")),
  correctionOfProviderRunId: v.optional(v.string()),
  sourceMissingFields: v.optional(v.array(v.string())),
  missingValuesConfirmed: v.optional(v.boolean()),
  transactionId: v.optional(v.id("financialTransactions")),
  notes: v.optional(v.string()),
};

export const workspace = authorizedQuery("payroll:workspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => payrollWorkspacePortable(await toPortableQueryCtx(ctx), args),
});

export const saveSettings = authorizedMutation("payroll:saveSettings", mutation)({
  args: {
    societyId: v.id("societies"),
    remitterType: v.string(),
    province: v.optional(v.string()),
    cadence: v.optional(v.string()),
    dueRule: v.optional(v.string()),
    dueValue: v.optional(v.number()),
    remittanceEffectiveFrom: v.optional(v.string()),
    remittanceNoticeReference: v.optional(v.string()),
    payrollAccountNumber: v.optional(v.string()),
    providerName: v.optional(v.string()),
    workersCompProvider: v.optional(v.string()),
    workersCompAccount: v.optional(v.string()),
    workersCompCadence: v.optional(v.string()),
    workersCompFirstDueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => payrollSaveSettingsPortable(await toPortableMutationCtx(ctx), args),
});

export const savePayRun = authorizedMutation("payroll:savePayRun", mutation)({
  args: { id: v.optional(v.id("payRuns")), societyId: v.id("societies"), ...payRunArgs },
  returns: v.any(),
  handler: async (ctx, args) => payrollSavePayRunPortable(await toPortableMutationCtx(ctx), args),
});

export const importPayRuns = authorizedMutation("payroll:importPayRuns", mutation)({
  args: {
    societyId: v.id("societies"),
    providerName: v.optional(v.string()),
    runs: v.array(v.object(payRunArgs)),
  },
  returns: v.any(),
  handler: async (ctx, args) => payrollImportPayRunsPortable(await toPortableMutationCtx(ctx), args),
});

export const removePayRun = authorizedMutation("payroll:removePayRun", mutation)({
  args: { id: v.id("payRuns") },
  returns: v.any(),
  handler: async (ctx, args) => payrollRemovePayRunPortable(await toPortableMutationCtx(ctx), args),
});

export const recordRemittance = authorizedMutation("payroll:recordRemittance", mutation)({
  args: {
    id: v.id("payrollRemittances"),
    paidCents: v.optional(v.number()),
    paidOn: v.optional(v.string()),
    confirmationNumber: v.optional(v.string()),
    transactionId: v.optional(v.id("financialTransactions")),
    notes: v.optional(v.string()),
    clear: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => payrollRecordRemittancePortable(await toPortableMutationCtx(ctx), args),
});

export const saveSlip = authorizedMutation("payroll:saveSlip", mutation)({
  args: {
    id: v.optional(v.id("payrollSlips")),
    societyId: v.id("societies"),
    year: v.number(),
    slipType: v.string(),
    employeeId: v.optional(v.id("employees")),
    providerEmployeeId: v.optional(v.string()),
    providerName: v.optional(v.string()),
    recipientName: v.string(),
    employmentIncomeCents: v.number(),
    cppCents: v.number(),
    cpp2Cents: v.optional(v.number()),
    eiCents: v.number(),
    incomeTaxCents: v.number(),
    otherIncomeCents: v.optional(v.number()),
    status: v.string(),
    issuedOn: v.optional(v.string()),
    filedOn: v.optional(v.string()),
    confirmationNumber: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => payrollSaveSlipPortable(await toPortableMutationCtx(ctx), args),
});

export const generateSlips = authorizedMutation("payroll:generateSlips", mutation)({
  args: { societyId: v.id("societies"), year: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => payrollGenerateSlipsPortable(await toPortableMutationCtx(ctx), args),
});

export const removeSlip = authorizedMutation("payroll:removeSlip", mutation)({
  args: { id: v.id("payrollSlips") },
  returns: v.any(),
  handler: async (ctx, args) => payrollRemoveSlipPortable(await toPortableMutationCtx(ctx), args),
});

export const saveRoe = authorizedMutation("payroll:saveRoe", mutation)({
  args: {
    id: v.optional(v.id("recordsOfEmployment")),
    societyId: v.id("societies"),
    employeeId: v.optional(v.id("employees")),
    employeeName: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    lastDayPaid: v.string(),
    dueDate: v.optional(v.string()),
    status: v.optional(v.string()),
    issuedOn: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => payrollSaveRoePortable(await toPortableMutationCtx(ctx), args),
});

export const removeRoe = authorizedMutation("payroll:removeRoe", mutation)({
  args: { id: v.id("recordsOfEmployment") },
  returns: v.any(),
  handler: async (ctx, args) => payrollRemoveRoePortable(await toPortableMutationCtx(ctx), args),
});

export const syncDeadlines = authorizedMutation("payroll:syncDeadlines", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => payrollSyncDeadlinesPortable(await toPortableMutationCtx(ctx), args),
});
