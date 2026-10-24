/** Shapes the business-register workspace queries return (shared/functions/businessRegisters.ts). */
import type { PayrollDeductionYtd } from "../../../shared/payrollDeductions";
import type { RemittanceScheduleRule, RemittanceScheduleChange, PayRunClassifiedBases } from "../../../shared/businessRegisters";

export type PayRunLineRow = {
  employeeId?: string;
  providerEmployeeId?: string;
  employeeName: string;
  provinceOfEmployment?: string;
  ehtLocationId?: string;
  ehtAttributionBasis?: "primary_reporting" | "reasonable_allocation";
  ehtAttributionEvidence?: string;
  vacationAccruedCents?: number;
  vacationPaidCents?: number;
  sickPaidDaysUsed?: number;
  sickUnpaidDaysUsed?: number;
  grossCents: number;
  nonCashTaxableCents?: number;
  nonTaxableCashCents?: number;
  cppEmployeeCents: number;
  cpp2EmployeeCents?: number;
  eiEmployeeCents: number;
  incomeTaxCents: number;
  federalTaxCents?: number;
  provincialTaxCents?: number;
  additionalIncomeTaxCents?: number;
  classifiedBases?: PayRunClassifiedBases;
  regularClassifiedBases?: PayRunClassifiedBases;
  bonusClassifiedBases?: PayRunClassifiedBases;
  deductionYtdDelta?: PayrollDeductionYtd;
  insurableHours?: number;
  otherDeductionsCents?: number;
  cppEmployerCents: number;
  cpp2EmployerCents?: number;
  eiEmployerCents: number;
  netCents: number;
};

export type PayRunRow = Omit<PayRunLineRow, "employeeId" | "employeeName" | "providerEmployeeId"> & {
  _id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  lines: PayRunLineRow[];
  headcount: number;
  remittableCents: number;
  differenceCents: number;
  source: string;
  providerName?: string;
  providerRunId?: string;
  runType?: string;
  correctsRunId?: string;
  correctionOfProviderRunId?: string;
  calculationId?: string;
  reversedDate?: string;
  reversalId?: string;
  sourceMissingFields?: string[];
  missingValuesConfirmed?: boolean;
  transactionId?: string;
  notes?: string;
};

export type RemittanceRow = {
  _id: string;
  payrollAccountNumber?: string;
  rpAccountEvidence?: string;
  rpAccountConfirmedAtISO?: string;
  rpAccountConfirmedByUserId?: string;
  periodStart: string;
  periodEnd: string;
  period: string;
  dueDate?: string;
  schedule?: RemittanceScheduleRule;
  amountDueCents: number;
  paidCents?: number;
  paidOn?: string;
  confirmationNumber?: string;
  transactionId?: string;
  notes?: string;
  status: "paid" | "partial" | "overdue" | "due" | "unscheduled";
  payRunCount: number;
  outstandingCents: number;
};

export type SlipRow = {
  _id: string;
  year: number;
  slipType: string;
  employeeId?: string;
  recipientName: string;
  employmentIncomeCents: number;
  cppCents: number;
  cpp2Cents?: number;
  providerEmployeeId?: string;
  providerName?: string;
  eiCents: number;
  incomeTaxCents: number;
  otherIncomeCents?: number;
  status: string;
  issuedOn?: string;
  filedOn?: string;
  confirmationNumber?: string;
  notes?: string;
  filingDeadline: string;
};

export type RoeRow = {
  _id: string;
  employeeId?: string;
  employeeName: string;
  reasonCode: string;
  lastDayPaid: string;
  dueDate?: string;
  status: string;
  issuedOn?: string;
  serialNumber?: string;
  notes?: string;
};

export type PayrollEmployee = { _id: string; name: string; providerEmployeeId?: string; employeeNumber?: string; role?: string; active: boolean; annualSalaryCents?: number; province?: string };

export type PayrollSettings = {
  remitterType: string;
  province?: string;
  cadence?: string;
  dueRule?: string;
  dueValue?: number;
  remittanceBaseline?: RemittanceScheduleRule;
  remittanceScheduleHistory?: RemittanceScheduleChange[];
  payrollAccountNumber?: string;
  providerName?: string;
  workersCompProvider?: string;
  workersCompAccount?: string;
  workersCompCadence?: string;
  workersCompFirstDueDate?: string;
};

export type PayrollWorkspace = {
  today: string;
  settings: PayrollSettings;
  scheduleComplete: boolean;
  runs: PayRunRow[];
  remittances: RemittanceRow[];
  slips: SlipRow[];
  roes: RoeRow[];
  employees: PayrollEmployee[] | null;
  summary: {
    year: number;
    ytdGrossCents: number;
    ytdRemittableCents: number;
    ytdCpp2EmployeeCents: number;
    ytdCpp2EmployerCents: number;
    ytdRunCount: number;
    openRemittanceCount: number;
    overdueRemittanceCount: number;
    outstandingCents: number;
    nextRemittance: { dueDate: string; amountCents: number; period: string; status: string } | null;
    slipYear: number;
    slipDeadline: string;
    slipCount: number;
    slipsFiled: number;
    roesToIssue: number;
  };
  deadlineChanges: number;
};

export type CardRow = {
  _id: string;
  nickname?: string;
  cardholderName: string;
  employeeId?: string;
  last4: string;
  issuer: string;
  network?: string;
  limitCents?: number;
  financialAccountId?: string;
  agreementDocumentId?: string;
  status: string;
  openedOn?: string;
  closedOn?: string;
  notes?: string;
  accountName?: string;
  agreementTitle?: string;
  balanceCents?: number;
  availableCents?: number;
  statementCount: number;
  unreconciledCount: number;
  latestStatementEnd?: string;
  receiptsMissing: number;
};

export type StatementRow = {
  _id: string;
  cardId: string;
  periodStart: string;
  periodEnd: string;
  statementDate?: string;
  paymentDueDate?: string;
  previousBalanceCents: number;
  statementBalanceCents: number;
  documentId?: string;
  documentTitle?: string;
  reconciledAtISO?: string;
  reconciledByName?: string;
  notes?: string;
  cardLabel: string;
  cardholderName?: string;
  transactionCount: number;
  purchasesCents: number;
  creditsCents: number;
  paymentsCents: number;
  expectedBalanceCents: number;
  differenceCents: number;
  receiptsMissing: number;
  pendingCount: number;
  status: "reconciled" | "balanced" | "difference";
};

export type CardsWorkspace = {
  today: string;
  cards: CardRow[];
  statements: StatementRow[];
  accounts: Array<{ _id: string; name: string }>;
  summary: { activeCards: number; totalLimitCents: number; balanceCents: number; toReconcile: number; withDifference: number; receiptsMissing: number };
};

export type HoldingRow = {
  _id: string;
  name: string;
  kind: string;
  kindLabel: string;
  institution: string;
  accountLast4?: string;
  principalCents: number;
  ratePercent?: number;
  compounding?: string;
  startDate: string;
  maturityDate?: string;
  interestPaidCents?: number;
  currentValueCents?: number;
  restricted: boolean;
  fundRestrictionId?: string;
  fundName?: string;
  documentId?: string;
  autoRenew?: boolean;
  status: string;
  redeemedOn?: string;
  notes?: string;
  effectiveStatus: "active" | "maturing" | "matured" | "redeemed";
  interestEarnedCents: number;
  accruedInterestCents: number;
  valueCents: number;
  daysToMaturity?: number;
  reminders: Array<{ daysBefore: number; date: string }>;
};

export type InvestedReservesSummary = {
  totalCents: number;
  restrictedCents: number;
  unrestrictedCents: number;
  principalCents: number;
  accruedCents: number;
  activeCount: number;
  nextMaturity: { name: string; date: string; daysAway: number } | null;
};

export type InvestmentsWorkspace = {
  today: string;
  holdings: HoldingRow[];
  funds: Array<{ _id: string; name: string }>;
  reserves: InvestedReservesSummary;
  reminderDays: number[];
  deadlineChanges: number;
};
