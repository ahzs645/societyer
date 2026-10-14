/**
 * Record-table objects for the business registers: pay runs, CRA remittances,
 * year-end slips and records of employment (Payroll), card accounts and
 * statements (Corporate cards), and reserve holdings (Investments).
 *
 * Rows are assembled by the owning page from the register workspace queries
 * (derived status, reconciliation, accrued interest), so most fields are
 * read-only projections; edits go through each page's drawer. Every field
 * carries a real type so search, filters, sorts, group-by, export and the
 * preview sidebar work from the metadata.
 *
 * Spread into RECORD_TABLE_OBJECTS by recordTableMetadataDefinitions.ts. Keep
 * this module free of runtime imports (the definitions module imports it).
 */
import type { SeedObject } from "./recordTableMetadataDefinitions";

const CAD = { currencyCode: "CAD", isCents: true };

const money = (name: string, label: string, icon = "DollarSign", description?: string) => ({
  name,
  label,
  fieldType: "CURRENCY",
  icon,
  isReadOnly: true,
  config: CAD,
  ...(description ? { description } : {}),
});

export const BUSINESS_REGISTER_RECORD_TABLE_OBJECTS: SeedObject[] = [
  /* ------------------------------------------------------------- payroll */
  {
    nameSingular: "payRun",
    namePlural: "payRuns",
    labelSingular: "Pay run",
    labelPlural: "Pay runs",
    icon: "Wallet",
    iconColor: "green",
    routePath: "/app/payroll",
    labelIdentifierFieldName: "period",
    fields: [
      { name: "period", label: "Pay period", fieldType: "TEXT", icon: "Calendar", isSystem: true, isReadOnly: true },
      { name: "payDate", label: "Pay date", fieldType: "DATE", icon: "CalendarClock", isReadOnly: true },
      { name: "headcount", label: "Employees", fieldType: "NUMBER", icon: "Users", isReadOnly: true },
      money("grossCents", "Gross pay"),
      money("deductionsCents", "Employee deductions", "Calculator", "CPP, EI, income tax and other deductions withheld from pay."),
      money("employerCents", "Employer CPP and EI", "Building"),
      money("netCents", "Net pay", "Wallet"),
      money("remittableCents", "Owed to the CRA", "Landmark", "Employee deductions plus the employer's CPP and EI."),
      {
        name: "source",
        label: "Source",
        fieldType: "SELECT",
        icon: "Tag",
        isReadOnly: true,
        config: { options: [{ value: "manual", label: "Entered", color: "gray" }, { value: "import", label: "Imported", color: "blue" }] },
      },
      { name: "providerName", label: "Payroll provider", fieldType: "TEXT", icon: "Building", isReadOnly: true },
      { name: "balanced", label: "Adds up", fieldType: "BOOLEAN", icon: "CheckCircle2", isReadOnly: true, config: { trueLabel: "Adds up", falseLabel: "Check amounts" } },
      { name: "notes", label: "Notes", fieldType: "TEXT", icon: "StickyNote", isReadOnly: true },
    ],
    defaultView: {
      name: "All pay runs",
      sorts: [{ fieldName: "payDate", direction: "desc" }],
      columns: [
        { fieldName: "period", size: 170 },
        { fieldName: "payDate", size: 130 },
        { fieldName: "headcount", size: 110 },
        { fieldName: "grossCents", size: 140 },
        { fieldName: "deductionsCents", size: 170 },
        { fieldName: "netCents", size: 140 },
        { fieldName: "remittableCents", size: 160 },
        { fieldName: "source", size: 120 },
      ],
    },
    extraViews: [
      { name: "Needs checking", filters: [{ fieldName: "balanced", operator: "isFalse", value: false }], sorts: [{ fieldName: "payDate", direction: "desc" }] },
    ],
  },
  {
    nameSingular: "payrollRemittance",
    namePlural: "payrollRemittances",
    labelSingular: "Remittance",
    labelPlural: "Source-deduction remittances",
    icon: "Landmark",
    iconColor: "green",
    routePath: "/app/payroll",
    labelIdentifierFieldName: "period",
    fields: [
      { name: "period", label: "Period", fieldType: "TEXT", icon: "Calendar", isSystem: true, isReadOnly: true },
      { name: "periodEnd", label: "Period end", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      { name: "dueDate", label: "Due", fieldType: "DATE", icon: "CalendarClock", isReadOnly: true },
      money("amountDueCents", "Amount due", "Landmark"),
      money("paidCents", "Paid", "CheckCircle2"),
      { name: "paidOn", label: "Paid on", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      {
        name: "status",
        label: "Status",
        fieldType: "SELECT",
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "due", label: "Due", color: "amber" },
            { value: "overdue", label: "Overdue", color: "red" },
            { value: "partial", label: "Part paid", color: "amber" },
            { value: "paid", label: "Paid", color: "green" },
            { value: "unscheduled", label: "Set the schedule", color: "gray" },
          ],
        },
      },
      { name: "payRunCount", label: "Pay runs", fieldType: "NUMBER", icon: "Hash", isReadOnly: true },
      { name: "confirmationNumber", label: "Confirmation", fieldType: "TEXT", icon: "Hash", isReadOnly: true },
    ],
    defaultView: {
      name: "All remittances",
      sorts: [{ fieldName: "periodEnd", direction: "desc" }],
      columns: [
        { fieldName: "period", size: 190 },
        { fieldName: "dueDate", size: 130 },
        { fieldName: "amountDueCents", size: 140 },
        { fieldName: "status", size: 130 },
        { fieldName: "paidOn", size: 130 },
        { fieldName: "confirmationNumber", size: 150 },
      ],
    },
    extraViews: [
      { name: "Open", filters: [{ fieldName: "status", operator: "in", value: ["due", "overdue", "partial", "unscheduled"] }], sorts: [{ fieldName: "dueDate", direction: "asc" }] },
    ],
  },
  {
    nameSingular: "payrollSlip",
    namePlural: "payrollSlips",
    labelSingular: "Slip",
    labelPlural: "Year-end slips",
    icon: "FileText",
    iconColor: "green",
    routePath: "/app/payroll",
    labelIdentifierFieldName: "recipientName",
    fields: [
      { name: "recipientName", label: "Recipient", fieldType: "TEXT", icon: "User", isSystem: true, isReadOnly: true },
      { name: "year", label: "Tax year", fieldType: "NUMBER", icon: "Calendar", isReadOnly: true, config: { decimals: 0 } },
      {
        name: "slipType",
        label: "Slip",
        fieldType: "SELECT",
        icon: "Tag",
        isReadOnly: true,
        config: { options: [{ value: "T4", label: "T4", color: "blue" }, { value: "T4A", label: "T4A", color: "purple" }, { value: "RL-1", label: "RL-1", color: "teal" }] },
      },
      money("employmentIncomeCents", "Income"),
      money("cppCents", "CPP"),
      money("eiCents", "EI"),
      money("incomeTaxCents", "Income tax"),
      {
        name: "status",
        label: "Status",
        fieldType: "SELECT",
        icon: "Activity",
        isReadOnly: true,
        config: { options: [{ value: "draft", label: "Draft", color: "gray" }, { value: "issued", label: "Given to recipient", color: "amber" }, { value: "filed", label: "Filed", color: "green" }] },
      },
      { name: "filingDeadline", label: "Filing deadline", fieldType: "DATE", icon: "CalendarClock", isReadOnly: true },
      { name: "filedOn", label: "Filed on", fieldType: "DATE", icon: "CheckCircle2", isReadOnly: true },
    ],
    defaultView: {
      name: "All slips",
      sorts: [{ fieldName: "year", direction: "desc" }],
      columns: [
        { fieldName: "recipientName", size: 200 },
        { fieldName: "year", size: 100 },
        { fieldName: "slipType", size: 100 },
        { fieldName: "employmentIncomeCents", size: 140 },
        { fieldName: "incomeTaxCents", size: 130 },
        { fieldName: "status", size: 160 },
        { fieldName: "filingDeadline", size: 140 },
      ],
    },
    extraViews: [
      { name: "Not filed", filters: [{ fieldName: "status", operator: "notIn", value: ["filed"] }], sorts: [{ fieldName: "filingDeadline", direction: "asc" }] },
    ],
  },
  {
    nameSingular: "recordOfEmployment",
    namePlural: "recordsOfEmployment",
    labelSingular: "Record of employment",
    labelPlural: "Records of employment",
    icon: "ClipboardCheck",
    iconColor: "green",
    routePath: "/app/payroll",
    labelIdentifierFieldName: "employeeName",
    fields: [
      { name: "employeeName", label: "Employee", fieldType: "TEXT", icon: "User", isSystem: true, isReadOnly: true },
      { name: "reason", label: "Reason", fieldType: "TEXT", icon: "Tag", isReadOnly: true },
      { name: "lastDayPaid", label: "Last day paid", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      { name: "dueDate", label: "Due", fieldType: "DATE", icon: "CalendarClock", isReadOnly: true },
      {
        name: "status",
        label: "Status",
        fieldType: "SELECT",
        icon: "Activity",
        isReadOnly: true,
        config: { options: [{ value: "to_issue", label: "To issue", color: "amber" }, { value: "issued", label: "Issued", color: "green" }] },
      },
      { name: "issuedOn", label: "Issued on", fieldType: "DATE", icon: "CheckCircle2", isReadOnly: true },
      { name: "serialNumber", label: "Serial number", fieldType: "TEXT", icon: "Hash", isReadOnly: true },
    ],
    defaultView: {
      name: "All records of employment",
      sorts: [{ fieldName: "lastDayPaid", direction: "desc" }],
      columns: [
        { fieldName: "employeeName", size: 200 },
        { fieldName: "reason", size: 200 },
        { fieldName: "lastDayPaid", size: 140 },
        { fieldName: "dueDate", size: 130 },
        { fieldName: "status", size: 120 },
        { fieldName: "serialNumber", size: 150 },
      ],
    },
  },

  /* ------------------------------------------------------- corporate cards */
  {
    nameSingular: "corporateCard",
    namePlural: "corporateCards",
    labelSingular: "Card",
    labelPlural: "Cards",
    icon: "Wallet",
    iconColor: "green",
    routePath: "/app/corporate-cards",
    labelIdentifierFieldName: "cardholderName",
    fields: [
      { name: "cardholderName", label: "Cardholder", fieldType: "TEXT", icon: "User", isSystem: true, isReadOnly: true },
      { name: "card", label: "Card", fieldType: "TEXT", icon: "Wallet", isReadOnly: true, description: "Issuer and last four digits. Full card numbers are never stored." },
      { name: "issuer", label: "Issuer", fieldType: "TEXT", icon: "Landmark", isReadOnly: true },
      money("limitCents", "Limit", "Gauge"),
      money("balanceCents", "Balance owed", "DollarSign", "From the linked card account in the bank feed."),
      money("availableCents", "Available", "Wallet"),
      { name: "accountName", label: "Feed account", fieldType: "TEXT", icon: "Database", isReadOnly: true },
      { name: "unreconciledCount", label: "Statements to reconcile", fieldType: "NUMBER", icon: "Scale", isReadOnly: true },
      { name: "receiptsMissing", label: "Receipts missing", fieldType: "NUMBER", icon: "Receipt", isReadOnly: true },
      { name: "agreementTitle", label: "Cardholder agreement", fieldType: "TEXT", icon: "Paperclip", isReadOnly: true },
      {
        name: "status",
        label: "Status",
        fieldType: "SELECT",
        icon: "Activity",
        isReadOnly: true,
        config: { options: [{ value: "active", label: "Active", color: "green" }, { value: "closed", label: "Closed", color: "gray" }] },
      },
    ],
    defaultView: {
      name: "All cards",
      columns: [
        { fieldName: "cardholderName", size: 190 },
        { fieldName: "card", size: 170 },
        { fieldName: "limitCents", size: 130 },
        { fieldName: "balanceCents", size: 140 },
        { fieldName: "unreconciledCount", size: 180 },
        { fieldName: "receiptsMissing", size: 150 },
        { fieldName: "status", size: 110 },
      ],
    },
  },
  {
    nameSingular: "cardStatement",
    namePlural: "cardStatements",
    labelSingular: "Card statement",
    labelPlural: "Card statements",
    icon: "Receipt",
    iconColor: "green",
    routePath: "/app/corporate-cards",
    labelIdentifierFieldName: "period",
    fields: [
      { name: "period", label: "Statement period", fieldType: "TEXT", icon: "Calendar", isSystem: true, isReadOnly: true },
      { name: "cardLabel", label: "Card", fieldType: "TEXT", icon: "Wallet", isReadOnly: true },
      { name: "periodEnd", label: "Period end", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      money("statementBalanceCents", "Statement balance"),
      money("expectedBalanceCents", "Feed balance", "Database", "Previous balance plus the card lines in the feed for the period."),
      money("differenceCents", "Difference", "Scale"),
      money("purchasesCents", "Charges", "Receipt"),
      { name: "transactionCount", label: "Card lines", fieldType: "NUMBER", icon: "Hash", isReadOnly: true },
      { name: "receiptsMissing", label: "Receipts missing", fieldType: "NUMBER", icon: "Receipt", isReadOnly: true },
      {
        name: "status",
        label: "Reconciliation",
        fieldType: "SELECT",
        icon: "Scale",
        isReadOnly: true,
        config: {
          options: [
            { value: "reconciled", label: "Reconciled", color: "green" },
            { value: "balanced", label: "Ready to reconcile", color: "blue" },
            { value: "difference", label: "Difference", color: "red" },
          ],
        },
      },
      { name: "paymentDueDate", label: "Payment due", fieldType: "DATE", icon: "CalendarClock", isReadOnly: true },
    ],
    defaultView: {
      name: "All statements",
      sorts: [{ fieldName: "periodEnd", direction: "desc" }],
      columns: [
        { fieldName: "period", size: 170 },
        { fieldName: "cardLabel", size: 170 },
        { fieldName: "statementBalanceCents", size: 160 },
        { fieldName: "differenceCents", size: 130 },
        { fieldName: "receiptsMissing", size: 150 },
        { fieldName: "status", size: 170 },
      ],
    },
    extraViews: [
      { name: "To reconcile", filters: [{ fieldName: "status", operator: "notIn", value: ["reconciled"] }], sorts: [{ fieldName: "periodEnd", direction: "desc" }] },
    ],
  },

  /* ----------------------------------------------------------- investments */
  {
    nameSingular: "investmentHolding",
    namePlural: "investmentHoldings",
    labelSingular: "Holding",
    labelPlural: "Investments",
    icon: "PiggyBank",
    iconColor: "green",
    routePath: "/app/investments",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Name", fieldType: "TEXT", icon: "PiggyBank", isSystem: true, isReadOnly: true },
      {
        name: "kind",
        label: "Type",
        fieldType: "SELECT",
        icon: "Tag",
        isReadOnly: true,
        config: {
          options: [
            { value: "gic", label: "GIC", color: "blue" },
            { value: "term_deposit", label: "Term deposit", color: "teal" },
            { value: "savings", label: "Savings account", color: "green" },
            { value: "investment_account", label: "Investment account", color: "purple" },
            { value: "other", label: "Other", color: "gray" },
          ],
        },
      },
      { name: "institution", label: "Institution", fieldType: "TEXT", icon: "Landmark", isReadOnly: true },
      money("principalCents", "Principal"),
      { name: "ratePercent", label: "Rate", fieldType: "NUMBER", icon: "BarChart", isReadOnly: true, config: { decimals: 2, suffix: "%" } },
      { name: "startDate", label: "Start", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      { name: "maturityDate", label: "Matures", fieldType: "DATE", icon: "CalendarClock", isReadOnly: true },
      money("accruedInterestCents", "Accrued interest", "BarChart"),
      money("valueCents", "Value today", "Wallet"),
      { name: "restricted", label: "Restricted", fieldType: "BOOLEAN", icon: "Shield", isReadOnly: true, config: { trueLabel: "Restricted", falseLabel: "Unrestricted" } },
      { name: "fundName", label: "Fund", fieldType: "TEXT", icon: "Shield", isReadOnly: true },
      {
        name: "effectiveStatus",
        label: "Status",
        fieldType: "SELECT",
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "active", label: "Active", color: "green" },
            { value: "maturing", label: "Maturing soon", color: "amber" },
            { value: "matured", label: "Matured", color: "red" },
            { value: "redeemed", label: "Redeemed", color: "gray" },
          ],
        },
      },
    ],
    defaultView: {
      name: "All holdings",
      sorts: [{ fieldName: "maturityDate", direction: "asc" }],
      columns: [
        { fieldName: "name", size: 220 },
        { fieldName: "kind", size: 120 },
        { fieldName: "principalCents", size: 140 },
        { fieldName: "ratePercent", size: 90 },
        { fieldName: "maturityDate", size: 130 },
        { fieldName: "valueCents", size: 140 },
        { fieldName: "restricted", size: 210 },
        { fieldName: "effectiveStatus", size: 140 },
      ],
    },
    extraViews: [
      { name: "Maturing soon", filters: [{ fieldName: "effectiveStatus", operator: "in", value: ["maturing", "matured"] }], sorts: [{ fieldName: "maturityDate", direction: "asc" }] },
      { name: "Restricted", filters: [{ fieldName: "restricted", operator: "isTrue", value: true }], sorts: [{ fieldName: "maturityDate", direction: "asc" }] },
    ],
  },
];
