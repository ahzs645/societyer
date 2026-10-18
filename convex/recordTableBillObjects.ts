/**
 * Record-table objects for payables: bills (Bills) and vendors (Vendors).
 *
 * Rows are assembled by the owning page from the bills workspace query
 * (derived status, balance, approvals, vendor totals), so every field is a
 * read-only projection; edits go through the page's drawers. Every field
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

const BILL_STATUS_OPTIONS = [
  { value: "draft", label: "Draft", color: "gray" },
  { value: "awaiting_approval", label: "Needs approval", color: "purple" },
  { value: "open", label: "Open", color: "blue" },
  { value: "scheduled", label: "Scheduled", color: "teal" },
  { value: "partially_paid", label: "Partially paid", color: "yellow" },
  { value: "paid", label: "Paid", color: "green" },
  { value: "overdue", label: "Overdue", color: "red" },
  { value: "canceled", label: "Canceled", color: "gray" },
];

export const BILL_RECORD_TABLE_OBJECTS: SeedObject[] = [
  {
    nameSingular: "bill",
    namePlural: "bills",
    labelSingular: "Bill",
    labelPlural: "Bills",
    icon: "ReceiptText",
    iconColor: "green",
    routePath: "/app/bills",
    labelIdentifierFieldName: "vendorName",
    fields: [
      { name: "vendorName", label: "Vendor", fieldType: "TEXT", icon: "Building", isSystem: true, isReadOnly: true },
      { name: "billNumber", label: "Bill #", fieldType: "TEXT", icon: "Hash", isReadOnly: true, description: "The vendor's invoice number, as printed on the bill." },
      { name: "billDate", label: "Date", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      { name: "dueDate", label: "Due date", fieldType: "DATE", icon: "CalendarClock", isReadOnly: true },
      { name: "status", label: "Status", fieldType: "SELECT", icon: "Activity", isReadOnly: true, config: { options: BILL_STATUS_OPTIONS } },
      money("totalCents", "Amount"),
      money("balanceCents", "Outstanding", "Wallet", "What is still owed after payments. Canceled bills owe nothing."),
      money("paidCents", "Paid", "CheckCircle2"),
      { name: "accountSummary", label: "Account", fieldType: "TEXT", icon: "BookOpen", isReadOnly: true, description: "Where the bill's lines go in the books." },
      { name: "approvalSummary", label: "Approvals", fieldType: "TEXT", icon: "ClipboardCheck", isReadOnly: true },
      { name: "scheduledDate", label: "Planned payment", fieldType: "DATE", icon: "CalendarCheck", isReadOnly: true },
      { name: "hasDocument", label: "Bill attached", fieldType: "BOOLEAN", icon: "Paperclip", isReadOnly: true, config: { trueLabel: "Attached", falseLabel: "Missing" } },
      { name: "notes", label: "Notes", fieldType: "TEXT", icon: "StickyNote", isReadOnly: true },
    ],
    defaultView: {
      name: "All bills",
      sorts: [{ fieldName: "dueDate", direction: "asc" }],
      columns: [
        { fieldName: "billNumber", size: 130 },
        { fieldName: "vendorName", size: 210 },
        { fieldName: "billDate", size: 120 },
        { fieldName: "dueDate", size: 120 },
        { fieldName: "status", size: 150 },
        { fieldName: "totalCents", size: 130 },
        { fieldName: "balanceCents", size: 140 },
      ],
    },
  },
  {
    nameSingular: "billVendor",
    namePlural: "billVendors",
    labelSingular: "Vendor",
    labelPlural: "Vendors",
    icon: "Building",
    iconColor: "green",
    routePath: "/app/bills/vendors",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Vendor", fieldType: "TEXT", icon: "Building", isSystem: true, isReadOnly: true },
      money("outstandingCents", "Outstanding", "Wallet"),
      money("overdueCents", "Overdue", "AlertTriangle"),
      money("paidCents", "Total paid", "CheckCircle2"),
      { name: "billCount", label: "Bills", fieldType: "NUMBER", icon: "Hash", isReadOnly: true },
      { name: "lastBillDate", label: "Last bill", fieldType: "DATE", icon: "Calendar", isReadOnly: true },
      { name: "defaultAccountLabel", label: "Default account", fieldType: "TEXT", icon: "BookOpen", isReadOnly: true },
      { name: "paymentMethodLabel", label: "Pays by", fieldType: "TEXT", icon: "Landmark", isReadOnly: true },
      { name: "email", label: "Email", fieldType: "EMAIL", icon: "Mail", isReadOnly: true },
      { name: "phone", label: "Phone", fieldType: "PHONE", icon: "Phone", isReadOnly: true },
      { name: "contactName", label: "Contact", fieldType: "TEXT", icon: "User", isReadOnly: true },
    ],
    defaultView: {
      name: "All vendors",
      sorts: [{ fieldName: "name", direction: "asc" }],
      columns: [
        { fieldName: "name", size: 220 },
        { fieldName: "outstandingCents", size: 140 },
        { fieldName: "overdueCents", size: 120 },
        { fieldName: "paidCents", size: 130 },
        { fieldName: "billCount", size: 90 },
        { fieldName: "lastBillDate", size: 120 },
        { fieldName: "defaultAccountLabel", size: 200 },
      ],
    },
  },
];
