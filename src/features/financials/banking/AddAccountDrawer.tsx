import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Segmented } from "../../../components/primitives";
import { DatePicker } from "../../../components/DatePicker";
import { useToast } from "../../../components/Toast";
import { parseMoneyInput, formatMoney } from "../../../lib/money";
import { todayDateOnly } from "../../../../shared/dateOnly";
import { BANK_ACCOUNT_KIND_LABELS, nextLedgerCode, validateNewBankAccount, type BankAccountKind } from "../../../../shared/bankAccounts";
import { errorMessage } from "./types";

type Draft = { kind: BankAccountKind; name: string; institution: string; lastFour: string; opening: string; openingDate: string };

const KINDS: BankAccountKind[] = ["bank", "credit", "payments", "cash"];
const NAME_PLACEHOLDER: Record<BankAccountKind, string> = {
  bank: "e.g. Savings account",
  credit: "e.g. Staff Visa",
  payments: "e.g. Stripe balance",
  cash: "e.g. Petty cash",
};

const emptyDraft = (): Draft => ({ kind: "bank", name: "", institution: "", lastFour: "", opening: "", openingDate: todayDateOnly() });

/**
 * Add a manual money account. It becomes its own ledger account under the
 * next free chart code for its type, starting at the opening balance.
 */
export function AddAccountDrawer({
  open,
  societyId,
  usedCodes,
  onClose,
  onCreated,
}: {
  open: boolean;
  societyId: string;
  usedCodes: readonly string[];
  onClose: () => void;
  onCreated: (accountId: string) => void;
}) {
  const create = useMutation(api.bankAccounts.createManualAccount);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDraft(emptyDraft());
      setErrors([]);
    }
  }, [open]);

  const set = (patch: Partial<Draft>) => {
    setErrors([]);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const isCredit = draft.kind === "credit";
  let codePreview = "";
  try {
    codePreview = nextLedgerCode(usedCodes, draft.kind);
  } catch {
    codePreview = "";
  }

  const submit = async () => {
    const entered = parseMoneyInput(draft.opening || "0");
    // A card balance is what's owed: stored as a negative balance.
    const openingBalanceCents = entered === undefined ? Number.NaN : isCredit ? -Math.abs(entered) : entered;
    const input = {
      name: draft.name,
      kind: draft.kind,
      openingBalanceCents,
      openingDate: draft.openingDate,
      lastFour: draft.lastFour.trim() || undefined,
    };
    const problems = validateNewBankAccount(input);
    setErrors(problems);
    if (problems.length) return;
    setBusy(true);
    try {
      const result = await create({ societyId, ...input, institution: draft.institution.trim() || undefined });
      toast.success("Account added", `${draft.name.trim()} is ledger account ${result.code}.`);
      onCreated(String(result.accountId));
    } catch (error: unknown) {
      toast.error("Could not add the account", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add account"
      className="bank-account-drawer"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={busy} onClick={() => void submit()}>Add account</button>
        </>
      }
    >
      <p className="muted bank-account-drawer__intro">
        For an account without a live feed: a savings account, a card, a payment processor balance or petty cash. Import a
        CSV statement into it whenever you like.
      </p>
      <Field label="Type">
        <Segmented<BankAccountKind> value={draft.kind} onChange={(kind) => set({ kind })} items={KINDS.map((id) => ({ id, label: BANK_ACCOUNT_KIND_LABELS[id] }))} />
      </Field>
      <Field label="Account name" required>
        <input className="input" value={draft.name} placeholder={NAME_PLACEHOLDER[draft.kind]} onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <div className="bank-account-drawer__row">
        <Field label="Institution" hint="Optional">
          <input className="input" value={draft.institution} placeholder="e.g. Riverbank Credit Union" onChange={(event) => set({ institution: event.target.value })} />
        </Field>
        <Field label="Last four digits" hint="Optional">
          <input className="input" inputMode="numeric" maxLength={4} value={draft.lastFour} onChange={(event) => set({ lastFour: event.target.value.replace(/\D/g, "") })} />
        </Field>
      </div>
      <div className="bank-account-drawer__row">
        <Field label={isCredit ? "Balance owed" : "Opening balance"} hint={isCredit ? "What the card owes on the opening date." : "The balance on the opening date."}>
          <input className="input" inputMode="decimal" placeholder="$0.00" value={draft.opening} onChange={(event) => set({ opening: event.target.value })} />
        </Field>
        <Field label="Opening date" required>
          <DatePicker value={draft.openingDate} onChange={(openingDate) => set({ openingDate })} clearable={false} />
        </Field>
      </div>
      <p className="bank-account-drawer__ledger">
        {codePreview
          ? <>Its ledger account is created in the chart of accounts as <strong>{codePreview} · {draft.name.trim() || "this account"}</strong>{draft.opening ? <>, starting at {formatMoney(isCredit ? -Math.abs(parseMoneyInput(draft.opening) ?? 0) : parseMoneyInput(draft.opening) ?? 0)}</> : null}. The first reconciliation begins from the opening balance.</>
          : "Every chart code for this type is in use; link the account to an existing ledger account after adding it."}
      </p>
      {errors.length > 0 && (
        <div className="rule-editor__errors" role="alert">
          {errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}
    </Drawer>
  );
}
