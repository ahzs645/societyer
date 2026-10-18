/**
 * The finance "Create" menu (the Create button on the Financials, reports and
 * register pages) and the matching ⌘K commands, as data. Every item opens the
 * create screen that already exists for it, through a URL the page acts on
 * (`?intent=…`, `?builder=new`, `?edit=new`, `?vendor=new`), so a link, the
 * menu and the palette all land in the same place.
 */
import type { ComponentType } from "react";
import {
  Building2,
  FileUp,
  GitCompareArrows,
  Landmark,
  ListTree,
  Receipt,
  ReceiptText,
  Tag,
  Tags,
  UserPlus,
  Zap,
} from "lucide-react";

export type FinanceCreateSection = "create" | "import" | "add";

export type FinanceCreateItem = {
  /** Also the ⌘K command id (pins keep working across renames). */
  id: string;
  section: FinanceCreateSection;
  /** Menu label, read under its section ("Create → Bill"). */
  label: string;
  /** The ⌘K command label. */
  commandLabel: string;
  /** Secondary text in the menu. */
  hint?: string;
  icon: ComponentType<{ size?: number | string }>;
  keywords: string[];
  to: string;
};

export const FINANCE_CREATE_SECTION_LABELS: Record<FinanceCreateSection, string> = {
  create: "Create",
  import: "Import",
  add: "Add",
};

export const FINANCE_CREATE_ITEMS: readonly FinanceCreateItem[] = [
  { id: "create-journal-entry", section: "create", label: "Journal entry", commandLabel: "New journal entry", icon: GitCompareArrows, keywords: ["journal", "ledger entry", "post entry", "adjusting entry", "accounting"], to: "/app/financials/journal-entries?intent=new-journal" },
  { id: "create-invoice", section: "create", label: "Invoice", commandLabel: "New invoice", icon: ReceiptText, keywords: ["invoice a customer", "dues invoice", "create invoice", "receivable"], to: "/app/invoices?builder=new" },
  { id: "create-bill", section: "create", label: "Bill", commandLabel: "New bill", icon: ReceiptText, keywords: ["vendor bill", "accounts payable", "pay a vendor", "create bill"], to: "/app/bills?edit=new" },
  { id: "action-new-transaction-rule", section: "create", label: "Rule", commandLabel: "New transaction rule", icon: Zap, keywords: ["categorisation rule", "categorization rule", "auto categorise", "bank rule"], to: "/app/transaction-rules?intent=new" },
  { id: "create-finance-tag", section: "create", label: "Tag", commandLabel: "New finance tag", icon: Tag, keywords: ["tag", "reporting tag", "dimension", "label transactions"], to: "/app/financials/tags?intent=new-tag" },
  { id: "create-finance-tag-group", section: "create", label: "Tag group", commandLabel: "New finance tag group", icon: Tags, keywords: ["tag group", "dimension", "program", "grant", "event"], to: "/app/financials/tags?intent=new-tag-group" },
  { id: "import-bank-csv", section: "import", label: "Bank CSV", commandLabel: "Import a bank CSV", hint: "Statement or card export", icon: FileUp, keywords: ["import transactions", "bank statement", "credit card csv", "upload csv"], to: "/app/financials?tab=transactions&intent=import-csv" },
  { id: "add-ledger-account", section: "add", label: "Ledger account", commandLabel: "New ledger account", icon: ListTree, keywords: ["chart of accounts", "gl account", "expense account", "income account"], to: "/app/financials/chart-of-accounts?intent=new-account" },
  { id: "add-customer", section: "add", label: "Customer", commandLabel: "New customer", hint: "From a new invoice's Bill to", icon: UserPlus, keywords: ["customer", "client", "bill to", "organization"], to: "/app/invoices?tab=customers&builder=new" },
  { id: "add-vendor", section: "add", label: "Vendor", commandLabel: "New vendor", icon: Building2, keywords: ["vendor", "supplier", "payee", "accounts payable"], to: "/app/bills/vendors?vendor=new" },
];

/** The menu's sections in order, each with its items. */
export function financeCreateSections(items: readonly FinanceCreateItem[] = FINANCE_CREATE_ITEMS) {
  return (Object.keys(FINANCE_CREATE_SECTION_LABELS) as FinanceCreateSection[])
    .map((section) => ({ section, label: FINANCE_CREATE_SECTION_LABELS[section], items: items.filter((item) => item.section === section) }))
    .filter((group) => group.items.length > 0);
}
