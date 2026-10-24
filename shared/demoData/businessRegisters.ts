/**
 * Demo data for the business registers: the payroll register (pay runs,
 * CRA remittances, last year's T4 slips and the WorkSafeBC reminder), the
 * organization Visa with its monthly statements, and two GICs held as
 * reserves (one tied to the restricted youth fund).
 *
 * Everything is derived from the generated bank feed so the registers and the
 * feed tell one story: each pay run's net pay is the "Brightwave Payroll"
 * deposit on that day, each month's deductions add up to the "CRA source
 * deductions" payment made the next month, and each card statement's
 * balances are the card account's running balance. One statement carries a
 * foreign transaction fee the feed hasn't picked up, so the reconciliation
 * view has a difference to find.
 *
 * Shared by the in-browser demo (src/lib/staticBusinessRegisterFixtures.ts)
 * and the server seed (shared/functions/seed.ts); callers choose ids through
 * `idFor`. Pure TypeScript: no Convex, DOM or Node imports.
 */
import {
  PAY_RUN_AMOUNT_FIELDS,
  addDays,
  monthEnd,
  monthStart,
  registerDeadlines,
  remittanceStatus,
  remittancesFromPayRuns,
  slipTotalsFromPayRuns,
  splitCents,
  type PayRunTotals,
  type PayRunLine,
} from "../businessRegisters";
import { addMonthsClamped } from "../invoicing";
import { demoNetPayCents, demoRemittanceCents } from "./bankFeed";
import { createRng } from "./prng";

export type DemoBusinessRegisterIdKind = "settings" | "payRun" | "remittance" | "slip" | "card" | "statement" | "holding" | "document" | "deadline";

export type DemoFeedTransaction = {
  _id: string;
  externalId?: string;
  accountId: string;
  date: string;
  amountCents: number;
  category?: string;
  status?: string;
};

export type DemoBusinessRegisterRefs = {
  societyId: string;
  cardAccountId: string;
  restrictedFundId?: string;
  /** The workspace's employees; pay runs split across them by salary. */
  employees: ReadonlyArray<{ id: string; name: string; annualSalaryCents?: number }>;
  /** Who reconciles statements in the story. */
  treasurerName: string;
  /** Bank-feed rows as stored (with their ids); externalId is `feed-<key>`. */
  feedTransactions: ReadonlyArray<DemoFeedTransaction>;
  idFor: (kind: DemoBusinessRegisterIdKind, key: string) => string;
  /** The workspace's local calendar date. */
  asOf: string;
};

/** Employee share of CPP and EI as a fraction of gross, and the employer's EI multiple. */
const CPP_RATE = 0.0595;
const EI_RATE = 0.0164;
const EMPLOYER_EI_MULTIPLE = 1.4;
/** gross = (net + remittance) / K, where K = 1 + employer CPP + employer EI as fractions of gross. */
const GROSS_FACTOR = 1 + CPP_RATE + EI_RATE * EMPLOYER_EI_MULTIPLE;

const CARD_LAST4 = "4417";
const STATEMENT_FX_FEE_CENTS = 412;

function feedKey(row: DemoFeedTransaction) {
  return String(row.externalId ?? "").replace(/^feed-/, "");
}

function nextMonthKey(monthKey: string) {
  return addMonthsClamped(`${monthKey}-01`, 1).slice(0, 7);
}

/** One semi-monthly run's amounts, net fixed to the deposit in the feed. */
function runAmounts(netCents: number, monthNetCents: number, remittanceCents: number): PayRunTotals {
  const grossCents = Math.round((netCents * (monthNetCents + remittanceCents)) / (monthNetCents * GROSS_FACTOR));
  const cppEmployeeCents = Math.round(grossCents * CPP_RATE);
  const eiEmployeeCents = Math.round(grossCents * EI_RATE);
  return {
    grossCents,
    cpp2EmployeeCents: 0,
    cpp2EmployerCents: 0,
    nonCashTaxableCents: 0,
    nonTaxableCashCents: 0,
    cppEmployeeCents,
    eiEmployeeCents,
    incomeTaxCents: grossCents - cppEmployeeCents - eiEmployeeCents - netCents,
    otherDeductionsCents: 0,
    cppEmployerCents: cppEmployeeCents,
    eiEmployerCents: Math.round(eiEmployeeCents * EMPLOYER_EI_MULTIPLE),
    netCents,
  };
}

function splitAcrossEmployees(run: PayRunTotals, employees: DemoBusinessRegisterRefs["employees"]): PayRunLine[] {
  if (!employees.length) return [];
  const weights = employees.map((employee) => employee.annualSalaryCents ?? 1);
  const parts = Object.fromEntries(PAY_RUN_AMOUNT_FIELDS.map((field) => [field, splitCents(run[field], weights)])) as Record<(typeof PAY_RUN_AMOUNT_FIELDS)[number], number[]>;
  return employees.map((employee, index) => {
    const line = {
      employeeId: employee.id,
      employeeName: employee.name,
      grossCents: parts.grossCents[index],
      cppEmployeeCents: parts.cppEmployeeCents[index],
      eiEmployeeCents: parts.eiEmployeeCents[index],
      incomeTaxCents: parts.incomeTaxCents[index],
      cppEmployerCents: parts.cppEmployerCents[index],
      eiEmployerCents: parts.eiEmployerCents[index],
      netCents: 0,
    };
    // Each line adds up on its own; the lines still sum to the run's net.
    line.netCents = line.grossCents - line.cppEmployeeCents - line.eiEmployeeCents - line.incomeTaxCents;
    return line;
  });
}

export function businessRegisterDemoRows(refs: DemoBusinessRegisterRefs) {
  const { societyId, asOf, idFor } = refs;
  const createdAtISO = `${addDays(asOf, -1)}T17:00:00.000Z`;
  const feedByKey = new Map(refs.feedTransactions.map((row) => [feedKey(row), row]));

  /* ------------------------------------------------------------ pay runs */
  const payRuns: Array<Record<string, any>> = [];
  const months = [...new Set(refs.feedTransactions.map(feedKey).filter((key) => /^payroll-\d{4}-\d{2}-[01]$/.test(key)).map((key) => key.slice(8, 15)))].sort();
  for (const month of months) {
    const remittanceCents = demoRemittanceCents(nextMonthKey(month));
    const monthNet = demoNetPayCents(month, 0) + demoNetPayCents(month, 1);
    const runs: Array<{ index: number; txn: DemoFeedTransaction; amounts: PayRunTotals }> = [];
    for (const index of [0, 1]) {
      const txn = feedByKey.get(`payroll-${month}-${index}`);
      if (!txn) continue;
      runs.push({ index, txn, amounts: runAmounts(-txn.amountCents, monthNet, remittanceCents) });
    }
    if (runs.length === 2) {
      // Rounding goes to the month-end run's income tax so the month remits exactly what the CRA was paid.
      const owed = runs.reduce((sum, run) => sum + run.amounts.cppEmployeeCents + run.amounts.eiEmployeeCents + run.amounts.incomeTaxCents + run.amounts.cppEmployerCents + run.amounts.eiEmployerCents, 0);
      const residual = remittanceCents - owed;
      runs[1].amounts.grossCents += residual;
      runs[1].amounts.incomeTaxCents += residual;
    }
    for (const run of runs) {
      const periodStart = run.index === 0 ? `${month}-01` : `${month}-16`;
      const periodEnd = run.index === 0 ? `${month}-15` : monthEnd(`${month}-01`);
      const amounts = run.amounts;
      payRuns.push({
        _id: idFor("payRun", `${month}-${run.index}`),
        societyId,
        periodStart,
        periodEnd,
        payDate: run.txn.date,
        grossCents: amounts.grossCents,
        cppEmployeeCents: amounts.cppEmployeeCents,
        eiEmployeeCents: amounts.eiEmployeeCents,
        incomeTaxCents: amounts.incomeTaxCents,
        cppEmployerCents: amounts.cppEmployerCents,
        eiEmployerCents: amounts.eiEmployerCents,
        netCents: amounts.netCents,
        lines: splitAcrossEmployees(amounts, refs.employees),
        source: "import",
        providerName: "Brightwave Payroll",
        transactionId: run.txn._id,
        createdAtISO,
        updatedAtISO: createdAtISO,
      });
    }
  }

  /* --------------------------------------------------------- remittances */
  const schedule = { remitterType: "regular" };
  const payrollRemittances = remittancesFromPayRuns(payRuns as any, schedule).map((period) => {
    const paidMonth = nextMonthKey(period.periodStart.slice(0, 7));
    const payment = feedByKey.get(`remittance-${paidMonth}`);
    const rng = createRng(`remittance-confirmation:${paidMonth}`);
    return {
      _id: idFor("remittance", period.periodStart),
      societyId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dueDate: period.dueDate ?? undefined,
      amountDueCents: period.amountDueCents,
      ...(payment
        ? {
            paidCents: -payment.amountCents,
            paidOn: payment.date,
            confirmationNumber: `CRA-${paidMonth.replace("-", "")}-${String(rng.int(1000, 9999))}`,
            transactionId: payment._id,
          }
        : {}),
      createdAtISO,
      updatedAtISO: createdAtISO,
    };
  });

  /* ------------------------------------------------- last year's T4 slips */
  const slipYear = Number(asOf.slice(0, 4)) - 1;
  const payrollSlips = [...slipTotalsFromPayRuns(payRuns as any, slipYear).values()].map((totals, index) => ({
    _id: idFor("slip", `${slipYear}-${index}`),
    societyId,
    year: slipYear,
    slipType: "T4",
    ...(totals.employeeId ? { employeeId: totals.employeeId } : {}),
    recipientName: totals.employeeName,
    employmentIncomeCents: totals.employmentIncomeCents,
    cppCents: totals.cppCents,
    eiCents: totals.eiCents,
    incomeTaxCents: totals.incomeTaxCents,
    status: "filed",
    issuedOn: `${slipYear + 1}-02-20`,
    filedOn: `${slipYear + 1}-02-24`,
    confirmationNumber: `T4-${slipYear}-${String(createRng(`t4:${slipYear}`).int(10000, 99999))}`,
    createdAtISO,
    updatedAtISO: createdAtISO,
  }));

  /* ------------------------------------------------------------ settings */
  const year = Number(asOf.slice(0, 4));
  const thisYearsReport = `${year}-02-${String(new Date(Date.UTC(year, 2, 0)).getUTCDate()).padStart(2, "0")}`;
  const nextYearsReport = `${year + 1}-02-${String(new Date(Date.UTC(year + 1, 2, 0)).getUTCDate()).padStart(2, "0")}`;
  const payrollSettings = [{
    _id: idFor("settings", "payroll"),
    societyId,
    remitterType: "regular",
    providerName: "Brightwave Payroll",
    workersCompProvider: "WorkSafeBC",
    workersCompAccount: "WSBC-RCS-22841",
    workersCompCadence: "annual",
    workersCompFirstDueDate: thisYearsReport >= asOf ? thisYearsReport : nextYearsReport,
    updatedAtISO: createdAtISO,
  }];

  /* ---------------------------------------------------------------- card */
  const agreementDocumentId = idFor("document", "visa-cardholder-agreement");
  const documents = [{
    _id: agreementDocumentId,
    societyId,
    title: "Organization Visa cardholder agreement",
    category: "Agreement",
    librarySection: "finance",
    fileName: "visa-cardholder-agreement.pdf",
    mimeType: "application/pdf",
    retentionYears: 7,
    createdAtISO: "2023-03-01T17:00:00.000Z",
    flaggedForDeletion: false,
    tags: ["finance", "card"],
  }];
  const cardholder = refs.employees[0];
  const cardId = idFor("card", "organization-visa");
  const corporateCards = [{
    _id: cardId,
    societyId,
    nickname: "Organization Visa",
    cardholderName: cardholder?.name ?? refs.treasurerName,
    ...(cardholder ? { employeeId: cardholder.id } : {}),
    last4: CARD_LAST4,
    issuer: "Riverbank Credit Union",
    network: "Visa",
    limitCents: 1_000_000,
    financialAccountId: refs.cardAccountId,
    agreementDocumentId,
    status: "active",
    openedOn: "2023-03-01",
    notes: "Program supplies, food and travel. Receipts go in within 7 days of the purchase.",
    createdAtISO,
    updatedAtISO: createdAtISO,
  }];

  /* ---------------------------------------------------------- statements */
  const cardRows = refs.feedTransactions.filter((row) => row.accountId === refs.cardAccountId);
  const owedThrough = (date: string) => -cardRows.filter((row) => row.date <= date).reduce((sum, row) => sum + row.amountCents, 0);
  const currentMonth = monthStart(asOf);
  const cardStatements = [4, 3, 2, 1].flatMap((back) => {
    const start = addMonthsClamped(currentMonth, -back);
    const end = monthEnd(start);
    if (!cardRows.some((row) => row.date >= start && row.date <= end)) return [];
    const withFee = back === 2;
    const reconciled = back >= 3;
    return [{
      _id: idFor("statement", start.slice(0, 7)),
      societyId,
      cardId,
      periodStart: start,
      periodEnd: end,
      statementDate: end,
      paymentDueDate: addDays(end, 22),
      previousBalanceCents: owedThrough(addDays(start, -1)),
      statementBalanceCents: owedThrough(end) + (withFee ? STATEMENT_FX_FEE_CENTS : 0),
      ...(reconciled ? { reconciledAtISO: `${addDays(end, 6)}T18:00:00.000Z`, reconciledByName: refs.treasurerName } : {}),
      ...(withFee ? { notes: "The statement lists a $4.12 foreign transaction fee that is not in the bank feed yet." } : {}),
      createdAtISO,
      updatedAtISO: createdAtISO,
    }];
  });

  /* ---------------------------------------------------------- investments */
  const operatingStart = addDays(asOf, -320);
  const youthStart = addDays(asOf, -200);
  const investmentHoldings = [
    {
      _id: idFor("holding", "operating-reserve-gic"),
      societyId,
      name: "Operating reserve GIC",
      kind: "gic",
      institution: "Riverbank Credit Union",
      accountLast4: "2208",
      principalCents: 2_500_000,
      ratePercent: 3.85,
      compounding: "simple",
      startDate: operatingStart,
      maturityDate: addDays(operatingStart, 365),
      restricted: false,
      autoRenew: true,
      status: "active",
      notes: "Three months of operating costs, held as the board's reserve.",
      createdAtISO,
      updatedAtISO: createdAtISO,
    },
    {
      _id: idFor("holding", "youth-fund-gic"),
      societyId,
      name: "Youth fund GIC",
      kind: "gic",
      institution: "Riverbank Credit Union",
      accountLast4: "2231",
      principalCents: 1_000_000,
      ratePercent: 4.1,
      compounding: "annual",
      startDate: youthStart,
      maturityDate: addMonthsClamped(youthStart, 18),
      restricted: true,
      ...(refs.restrictedFundId ? { fundRestrictionId: refs.restrictedFundId } : {}),
      autoRenew: false,
      status: "active",
      notes: "Grant money not needed until the program's second year.",
      createdAtISO,
      updatedAtISO: createdAtISO,
    },
  ];

  /* ------------------------------------------------------------ deadlines */
  const deadlines = registerDeadlines(
    {
      remittances: payrollRemittances,
      slips: payrollSlips,
      payDates: payRuns.map((run) => run.payDate),
      roes: [],
      settings: payrollSettings[0],
      holdings: investmentHoldings,
    },
    asOf,
    [],
  )
    .filter((item) => !item.done)
    .map((item) => ({
      _id: idFor("deadline", item.sourceKey),
      societyId,
      title: item.title,
      description: item.description,
      dueDate: item.dueDate,
      category: item.category,
      status: "open",
      done: false,
      recurrence: "None",
      sourceKey: item.sourceKey,
    }));

  return {
    payrollSettings,
    payRuns,
    payrollRemittances,
    payrollSlips,
    documents,
    corporateCards,
    cardStatements,
    investmentHoldings,
    deadlines,
    summary: {
      openRemittances: payrollRemittances.filter((row) => remittanceStatus(row as any, asOf) !== "paid").length,
    },
  };
}
