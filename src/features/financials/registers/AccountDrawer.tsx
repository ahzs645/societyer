import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { BookOpen } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Money } from "../../../components/Money";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import { accountParentError, accountSection, eligibleParents, type HierarchyAccount } from "../../../../shared/accountHierarchy";
import { booksErrorMessage } from "../settings/booksSettings";
import { accountRefLabel, humanise } from "./registerModel";
import type { ChartAccountRecord } from "./registerRecords";

const ACCOUNT_TYPES = ["Asset", "Bank", "Liability", "Credit", "Equity", "Income", "Expense"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];
type NormalBalance = "debit" | "credit";

const TYPE_OPTIONS: Array<{ value: AccountType; label: string; hint: string }> = [
  { value: "Asset", label: "Asset", hint: "Assets" },
  { value: "Bank", label: "Bank", hint: "Assets" },
  { value: "Liability", label: "Liability", hint: "Liabilities" },
  { value: "Credit", label: "Credit card", hint: "Liabilities" },
  { value: "Equity", label: "Net assets", hint: "Equity" },
  { value: "Income", label: "Revenue", hint: "Income" },
  { value: "Expense", label: "Expense", hint: "Expenses" },
];

const CREDIT_NORMAL_TYPES: ReadonlySet<string> = new Set(["Liability", "Credit", "Equity", "Income"]);
const CODE_PATTERN = /^[A-Za-z0-9.-]{1,12}$/;
const NEW_ACCOUNT_ID = "__new";

function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

function defaultNormalBalance(type: string): NormalBalance {
  return CREDIT_NORMAL_TYPES.has(type) ? "credit" : "debit";
}

type Draft = {
  code: string;
  name: string;
  accountType: AccountType;
  subtype: string;
  normalBalance: NormalBalance;
  /** The person picked a normal balance, so changing the type leaves it alone. */
  normalBalanceChosen: boolean;
  parentAccountId: string;
};

function initialDraft(account: ChartAccountRecord | null): Draft {
  const accountType = account && isAccountType(account.accountType) ? account.accountType : "Expense";
  return {
    code: account?.code ?? "",
    name: account?.name ?? "",
    accountType,
    subtype: account?.subtype ?? "",
    normalBalance: account ? (account.creditNormal ? "credit" : "debit") : defaultNormalBalance(accountType),
    normalBalanceChosen: Boolean(account),
    parentAccountId: account?.parentAccountId ? String(account.parentAccountId) : "",
  };
}

type Errors = Partial<Record<"code" | "name" | "accountType" | "parentAccountId", string>>;

/**
 * Add or edit a chart account: code, name, type, subtype, normal balance and
 * parent account. Read-only for people without finance write access. Mount it
 * with a `key` per account so the form starts fresh each time it opens.
 */
export function AccountDrawer({ societyId, account, accounts, canWrite, onClose }: {
  societyId: Id<"societies">;
  /** null for a new account. */
  account: ChartAccountRecord | null;
  accounts: readonly ChartAccountRecord[];
  canWrite: boolean;
  onClose: () => void;
}) {
  const upsert = useMutation(api.accounting.upsertChartAccount);
  const toast = useToast();
  const subtypeListId = useId();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(account));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const accountId = account?._id ?? NEW_ACCOUNT_ID;
  const currency = account?.currency ?? accounts.find((row) => row.currency)?.currency ?? "CAD";
  const hasLines = Boolean(account && account.lineCount > 0);
  const originalSection = account ? accountSection(account.accountType) : null;
  const section = accountSection(draft.accountType);

  // The chart as it would be with this draft saved, for the parent rules.
  const chart = useMemo<HierarchyAccount[]>(() => [
    ...accounts
      .filter((row) => row._id !== accountId)
      .map((row) => ({ _id: row._id, code: row.code, name: row.name, accountType: row.accountType, currency: row.currency, parentAccountId: row.parentAccountId ? String(row.parentAccountId) : null })),
    { _id: accountId, code: draft.code.trim() || null, name: draft.name.trim() || "This account", accountType: draft.accountType, currency, parentAccountId: draft.parentAccountId || null },
  ], [accounts, accountId, draft.code, draft.name, draft.accountType, draft.parentAccountId, currency]);

  const parentOptions = useMemo(() => {
    const option = (parent: HierarchyAccount) => ({ value: String(parent._id), label: accountRefLabel({ code: parent.code ?? undefined, name: parent.name }) });
    const options = eligibleParents(chart, accountId).map(option);
    // Keep a current parent that no longer qualifies visible, with its error below.
    const current = draft.parentAccountId ? chart.find((row) => row._id === draft.parentAccountId) : undefined;
    return current && !options.some((row) => row.value === current._id) ? [option(current), ...options] : options;
  }, [chart, accountId, draft.parentAccountId]);

  const subtypeSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of accounts) {
      if (row.subtype && accountSection(row.accountType) === section) seen.add(row.subtype);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [accounts, section]);

  const errors: Errors = {};
  const code = draft.code.trim();
  if (!draft.name.trim()) errors.name = "Give the account a name.";
  if (code && !CODE_PATTERN.test(code)) errors.code = "Use up to 12 letters, digits, dots or dashes.";
  else if (code && accounts.some((row) => row.code === code && row._id !== accountId)) errors.code = `Account code ${code} is already used.`;
  if (hasLines && originalSection !== section) {
    errors.accountType = "This account has journal lines, so it stays in its statement section. Create a new account and move the balance with a journal entry.";
  }
  const parentError = draft.parentAccountId ? accountParentError(chart, accountId, draft.parentAccountId) : null;
  if (parentError) errors.parentAccountId = parentError;
  const hasErrors = Object.keys(errors).length > 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const changeType = (next: AccountType) =>
    setDraft((current) => ({
      ...current,
      accountType: next,
      normalBalance: current.normalBalanceChosen ? current.normalBalance : defaultNormalBalance(next),
      // A parent must sit in the same statement section.
      parentAccountId: accountSection(next) === accountSection(current.accountType) ? current.parentAccountId : "",
    }));

  const save = async () => {
    setShowErrors(true);
    if (hasErrors || !canWrite) return;
    setSaving(true);
    try {
      await upsert({
        ...(account ? { id: account._id as Id<"financialAccounts"> } : {}),
        societyId,
        code: code || undefined,
        name: draft.name.trim(),
        accountType: draft.accountType,
        subtype: draft.subtype.trim() || undefined,
        normalBalance: draft.normalBalance,
        currency,
        parentAccountId: draft.parentAccountId ? (draft.parentAccountId as Id<"financialAccounts">) : undefined,
      });
      toast.success(account ? "Account saved" : "Account added");
      onClose();
    } catch (error) {
      toast.error("Account not saved", booksErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const shown = (key: keyof Errors) => (showErrors || key === "accountType" || key === "parentAccountId" ? errors[key] : undefined);
  const title = !canWrite ? "Account" : account ? "Edit account" : "New account";

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      footer={canWrite ? (
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={saving || (showErrors && hasErrors)} onClick={() => void save()}>
            {account ? "Save account" : "Add account"}
          </button>
        </>
      ) : (
        <button type="button" className="btn" onClick={onClose}>Close</button>
      )}
    >
      {account && <AccountFacts account={account} />}
      <div className="books-register__form">
        <Field label="Code" error={shown("code")} hint="Optional, e.g. 5210. Up to 12 letters, digits, dots or dashes.">
          <input className="input" value={draft.code} disabled={!canWrite} onChange={(event) => set("code", event.target.value)} />
        </Field>
        <Field label="Name" required error={shown("name")}>
          <input className="input" value={draft.name} disabled={!canWrite} onChange={(event) => set("name", event.target.value)} />
        </Field>
        <Field
          label="Type"
          error={shown("accountType")}
          hint={hasLines && account ? `This account has ${pluralize(account.lineCount, "journal line")}, so its type can only change within its statement section (for example Asset to Bank).` : undefined}
        >
          <Select<AccountType> value={draft.accountType} disabled={!canWrite} onChange={changeType} options={TYPE_OPTIONS} />
        </Field>
        <Field label="Subtype" hint="Optional grouping, e.g. accounts_receivable or program_expense. Pick an existing one or type a new one.">
          <input className="input" list={subtypeListId} value={draft.subtype} disabled={!canWrite} onChange={(event) => set("subtype", event.target.value)} />
        </Field>
        <datalist id={subtypeListId}>
          {subtypeSuggestions.map((subtype) => <option key={subtype} value={subtype}>{humanise(subtype)}</option>)}
        </datalist>
        <Field label="Normal balance" hint="The side that increases the account. Debit for assets and expenses; credit for liabilities, net assets and revenue.">
          <Select<NormalBalance>
            value={draft.normalBalance}
            disabled={!canWrite}
            onChange={(next) => setDraft((current) => ({ ...current, normalBalance: next, normalBalanceChosen: true }))}
            options={[{ value: "debit", label: "Debit" }, { value: "credit", label: "Credit" }]}
          />
        </Field>
        <Field label="Parent account" error={shown("parentAccountId")} hint={`Sub-accounts roll up into their parent on the statements. Only ${currency} accounts in the same statement section can be the parent.`}>
          <Select
            value={draft.parentAccountId}
            disabled={!canWrite}
            onChange={(next) => set("parentAccountId", next)}
            clearable
            clearLabel="No parent (top level)"
            placeholder="No parent (top level)"
            options={parentOptions}
          />
        </Field>
      </div>
    </Drawer>
  );
}

/** Balance, opening balance and line count of an existing account, with its general-ledger link. */
function AccountFacts({ account }: { account: ChartAccountRecord }) {
  const currency = account.currency ?? undefined;
  return (
    <dl className="books-register__facts">
      <div><dt>Balance</dt><dd><Money cents={account.balanceCents} currency={currency} /></dd></div>
      <div><dt>Opening balance</dt><dd><Money cents={account.openingBalanceCents} currency={currency} /></dd></div>
      <div><dt>Lines</dt><dd className="num">{account.lineCount}</dd></div>
      <div className="books-register__facts-link">
        <Link to={`/app/financials/reports/general-ledger?account=${encodeURIComponent(account._id)}`}>
          <BookOpen size={12} aria-hidden="true" /> Open in general ledger
        </Link>
      </div>
    </dl>
  );
}
