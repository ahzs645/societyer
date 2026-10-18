/**
 * Record-table objects for the books registers: journal entries
 * (/app/financials/journal-entries) and the chart of accounts
 * (/app/financials/chart-of-accounts).
 *
 * Rows come from `accounting.journalEntryRegister` and
 * `accounting.chartOfAccountsRegister` (account lists, totals, balances and
 * hierarchy already derived), so every field is a read-only projection; edits
 * go through each page's drawer. Every field carries a real type so search,
 * filters, sorts, group-by and export work from the metadata.
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

const SECTION_OPTIONS = [
  { value: "assets", label: "Assets", color: "blue" },
  { value: "liabilities", label: "Liabilities", color: "orange" },
  { value: "equity", label: "Net assets", color: "purple" },
  { value: "income", label: "Revenue", color: "green" },
  { value: "expenses", label: "Expenses", color: "red" },
];

export const BOOKS_RECORD_TABLE_OBJECTS: SeedObject[] = [
  /* ------------------------------------------------------- journal entries */
  {
    nameSingular: "journalEntryRegister",
    namePlural: "journalEntries",
    labelSingular: "Journal entry",
    labelPlural: "Journal entries",
    icon: "BookOpen",
    iconColor: "green",
    routePath: "/app/financials/journal-entries",
    labelIdentifierFieldName: "memo",
    fields: [
      { name: "memo", label: "Description", fieldType: "TEXT", icon: "FileText", isSystem: true, isReadOnly: true },
      { name: "date", label: "Date", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      { name: "createdAtISO", label: "Date created", fieldType: "DATE_TIME", icon: "CalendarClock", isReadOnly: true },
      { name: "entryNumber", label: "Entry number", fieldType: "TEXT", icon: "Hash", isReadOnly: true },
      { name: "reference", label: "Reference", fieldType: "TEXT", icon: "Hash", isReadOnly: true },
      { name: "debitAccountNames", label: "Debit ledger account", fieldType: "TEXT", icon: "Network", isReadOnly: true },
      { name: "creditAccountNames", label: "Credit ledger account", fieldType: "TEXT", icon: "Network", isReadOnly: true },
      money("amountCents", "Amount", "DollarSign", "Total of the debit lines (equal to the credit lines)."),
      {
        name: "status",
        label: "Status",
        fieldType: "SELECT",
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "posted", label: "Posted", color: "green" },
            { value: "draft", label: "Draft", color: "amber" },
            { value: "void", label: "Void", color: "gray" },
          ],
        },
      },
      {
        name: "source",
        label: "Source",
        fieldType: "SELECT",
        icon: "Tag",
        isReadOnly: true,
        config: {
          options: [
            { value: "manual", label: "Manual", color: "gray" },
            { value: "adjustment", label: "Adjustment", color: "purple" },
            { value: "opening_balance", label: "Opening balance", color: "blue" },
            { value: "transactionCandidate", label: "Bank transaction", color: "teal" },
            { value: "financialTransactionBackfill", label: "Bank backfill", color: "teal" },
            { value: "expenseReport", label: "Expense claim", color: "orange" },
            { value: "invoice", label: "Invoice", color: "green" },
            { value: "bill", label: "Bill", color: "orange" },
            { value: "import", label: "Import", color: "blue" },
          ],
        },
      },
      {
        name: "basis",
        label: "Basis",
        fieldType: "SELECT",
        icon: "Scale",
        isReadOnly: true,
        description: "Which reports include the entry: both bases, accrual only (invoice and bill accruals) or cash only (their recognition on payment).",
        config: {
          options: [
            { value: "both", label: "Cash and accrual", color: "gray" },
            { value: "accrual-only", label: "Accrual only", color: "blue" },
            { value: "cash-only", label: "Cash only", color: "teal" },
          ],
        },
      },
      { name: "sections", label: "Sections", fieldType: "MULTI_SELECT", icon: "Tags", isReadOnly: true, config: { options: SECTION_OPTIONS } },
      { name: "lineCount", label: "Lines", fieldType: "NUMBER", icon: "Hash", isReadOnly: true, config: { decimals: 0 } },
      {
        name: "locked",
        label: "Locked",
        fieldType: "BOOLEAN",
        icon: "LockKeyhole",
        isReadOnly: true,
        description: "Dated on or before the books close date, so it can't be edited or voided.",
        config: { trueLabel: "Closed period", falseLabel: "Open" },
      },
      {
        name: "reviewFlags",
        label: "Review",
        fieldType: "MULTI_SELECT",
        icon: "AlertTriangle",
        isReadOnly: true,
        config: {
          options: [
            { value: "before_opening_balance", label: "Before opening balances", color: "amber" },
            { value: "unmapped_suspense", label: "Suspense", color: "amber" },
          ],
        },
      },
    ],
    defaultView: {
      name: "All journal entries",
      openRecordIn: "page",
      sorts: [
        { fieldName: "date", direction: "desc" },
        { fieldName: "createdAtISO", direction: "desc" },
      ],
      columns: [
        { fieldName: "memo", size: 280 },
        { fieldName: "createdAtISO", size: 150 },
        { fieldName: "date", size: 120 },
        { fieldName: "debitAccountNames", size: 230 },
        { fieldName: "creditAccountNames", size: 230 },
        { fieldName: "amountCents", size: 140 },
        { fieldName: "status", size: 110 },
        { fieldName: "source", size: 150 },
        { fieldName: "reviewFlags", size: 180 },
      ],
    },
    extraViews: [
      { name: "Needs review", filters: [{ fieldName: "reviewFlags", operator: "isNotEmpty", value: null }], sorts: [{ fieldName: "date", direction: "desc" }] },
    ],
  },

  /* ----------------------------------------------------- chart of accounts */
  {
    nameSingular: "ledgerAccount",
    namePlural: "financialAccounts",
    labelSingular: "Ledger account",
    labelPlural: "Chart of accounts",
    icon: "Network",
    iconColor: "green",
    routePath: "/app/financials/chart-of-accounts",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Account", fieldType: "TEXT", icon: "Network", isSystem: true, isReadOnly: true },
      { name: "code", label: "Code", fieldType: "TEXT", icon: "Hash", isReadOnly: true },
      {
        name: "accountType",
        label: "Type",
        fieldType: "SELECT",
        icon: "Tag",
        isReadOnly: true,
        config: {
          options: [
            { value: "Asset", label: "Asset", color: "blue" },
            { value: "Bank", label: "Bank", color: "teal" },
            { value: "Liability", label: "Liability", color: "orange" },
            { value: "Credit", label: "Credit card", color: "amber" },
            { value: "Equity", label: "Net assets", color: "purple" },
            { value: "Income", label: "Revenue", color: "green" },
            { value: "Expense", label: "Expense", color: "red" },
          ],
        },
      },
      { name: "subtypeLabel", label: "Subtype", fieldType: "TEXT", icon: "Tags", isReadOnly: true },
      {
        name: "normalSide",
        label: "Normal balance",
        fieldType: "SELECT",
        icon: "Scale",
        isReadOnly: true,
        description: "The side that increases the account: debit for assets and expenses, credit for liabilities, net assets and revenue.",
        config: { options: [{ value: "debit", label: "Debit", color: "gray" }, { value: "credit", label: "Credit", color: "gray" }] },
      },
      money("openingBalanceCents", "Opening balance", "Calendar", "The amount on the opening-balance entry."),
      money("balanceCents", "Balance", "Scale", "Posted balance today, in the account's normal direction."),
      { name: "lineCount", label: "Lines", fieldType: "NUMBER", icon: "Hash", isReadOnly: true, config: { decimals: 0 } },
      { name: "section", label: "Statement section", fieldType: "SELECT", icon: "Network", isReadOnly: true, config: { options: SECTION_OPTIONS } },
      { name: "parentName", label: "Parent account", fieldType: "TEXT", icon: "Network", isReadOnly: true },
      { name: "currency", label: "Currency", fieldType: "TEXT", icon: "DollarSign", isReadOnly: true },
      { name: "chartOrder", label: "Chart order", fieldType: "NUMBER", icon: "Hash", isReadOnly: true, isHidden: true, config: { decimals: 0 } },
    ],
    defaultView: {
      name: "All accounts",
      openRecordIn: "page",
      sorts: [{ fieldName: "chartOrder", direction: "asc" }],
      columns: [
        { fieldName: "name", size: 280 },
        { fieldName: "code", size: 100 },
        { fieldName: "accountType", size: 130 },
        { fieldName: "subtypeLabel", size: 170 },
        { fieldName: "normalSide", size: 140 },
        { fieldName: "openingBalanceCents", size: 150 },
        { fieldName: "balanceCents", size: 150 },
        { fieldName: "lineCount", size: 90 },
      ],
    },
  },
];
